using System.Runtime.InteropServices;

namespace MeetingNotes.Sidecar;

/// <summary>Opt-in Alpha: one delayed, scaled loopback tap, not a room impulse model.</summary>
internal sealed class EchoCancellation
{
    internal enum Phase { WarmingUp, Active, Bypass, Off }

    private enum Outcome
    {
        Filtered, MicProcessingBusy, InvalidMicPacket, MicDiscontinuity, ReferenceSnapshotBusy, ReferenceUnavailable,
        ReferenceTimestampOffset, PartialBlock, MicClipped, MicQuiet, ReferenceWindowUnavailable,
        SearchCooldown, NoReferenceMatch, LowCorrelation, GainOutOfRange, GainUnstable, WarmingUp,
        ReferenceChanged, ProcessingError
    }

    private static readonly Outcome[] Outcomes = Enum.GetValues<Outcome>();

    private sealed class Diagnostics
    {
        internal readonly long[] Blocks = new long[Outcomes.Length];
        internal long Candidates;
        internal int MinDelay = int.MaxValue, MaxDelay = int.MinValue;
        internal double MinCorrelation = 1, MaxCorrelation;
        internal double InputEnergy, OutputEnergy;

        internal void Candidate(int delay, double correlation)
        {
            Candidates++;
            MinDelay = Math.Min(MinDelay, delay);
            MaxDelay = Math.Max(MaxDelay, delay);
            MinCorrelation = Math.Min(MinCorrelation, correlation);
            MaxCorrelation = Math.Max(MaxCorrelation, correlation);
        }
    }

    private Diagnostics _diagnostics = new();
    private long _micBusyBlocks;

    private readonly object _gate = new(); // Mic processing and lifecycle
    private readonly object _historyGate = new(); // only packet copy / snapshot
    private readonly int _rate;
    private readonly int _block;
    private readonly int _capacity;
    private short[] _reference;
    private short[] _snapshot;
    private short[] _micTail;
    private int _tailLength;
    private long _head; // exclusive end, in samples since the last reference reset
    private long _referenceTime;
    private int _referenceLength;
    private long _micTime;
    private int _micLength;
    private long _historyRevision;
    private long _writtenRevision;
    private long _readRevision;
    private long _snapshotStart;
    private int _snapshotLength;
    private int _delay;
    private double _gain;
    private int _matches;
    private int _misses;
    private int _searchCooldown;
    private bool _paused;
    private bool _stopped;
    private volatile Phase _state = Phase.WarmingUp;

    internal EchoCancellation(int sampleRate)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(sampleRate, 8000);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(sampleRate, 48000);
        _rate = sampleRate;
        _block = sampleRate / 100;
        _capacity = sampleRate * 2 / 5;
        // Mirror the ring so each candidate block is contiguous, even at wrap.
        _reference = new short[_capacity * 2];
        _snapshot = new short[_capacity];
        _micTail = new short[_block];
    }

    internal Phase State => _state;

    internal string? TakeDiagnosticSummary()
    {
        var next = new Diagnostics();
        Diagnostics interval;
        Phase phase;
        if (!Monitor.TryEnter(_gate)) return null;
        try
        {
            interval = _diagnostics;
            _diagnostics = next;
            phase = _state;
        }
        finally { Monitor.Exit(_gate); }
        interval.Blocks[(int)Outcome.MicProcessingBusy] = Interlocked.Exchange(ref _micBusyBlocks, 0);
        var total = interval.Blocks.Sum();
        if (total == 0) return null;
        var filtered = interval.Blocks[(int)Outcome.Filtered];
        var skipped = string.Join(", ", Outcomes.Skip(1).Where(reason => interval.Blocks[(int)reason] > 0)
            .Select(reason => $"{reason}={interval.Blocks[(int)reason]}"));
        var candidates = interval.Candidates == 0 ? "candidateDelayMs=n/a; absCorrelation=n/a" :
            FormattableString.Invariant($"candidateDelayMs={1000.0 * interval.MinDelay / _rate:F2}..{1000.0 * interval.MaxDelay / _rate:F2}; absCorrelation={interval.MinCorrelation:F3}..{interval.MaxCorrelation:F3}");
        var reduction = interval.InputEnergy == 0 ? "n/a" : interval.OutputEnergy == 0 ? "inf" :
            FormattableString.Invariant($"{10 * Math.Log10(interval.InputEnergy / interval.OutputEnergy):F2}");
        return FormattableString.Invariant($"Echo cancellation (Alpha): phase={phase}; filtered={filtered}/{total} blocks ({100.0 * filtered / total:F1}%); skipped=[{skipped}]; candidates={interval.Candidates}; {candidates}; micReductionDb={reduction}.");
    }

    private void Count(Outcome outcome, int blocks = 1) => _diagnostics.Blocks[(int)outcome] += blocks;

    private void MeasureMic(ReadOnlySpan<short> input, byte[]? corrected)
    {
        double inputEnergy = 0, outputEnergy = 0;
        foreach (var sample in input) inputEnergy += (double)sample * sample;
        if (corrected is null) outputEnergy = inputEnergy;
        else foreach (var sample in MemoryMarshal.Cast<byte, short>(corrected.AsSpan()))
            outputEnergy += (double)sample * sample;
        _diagnostics.InputEnergy += inputEnergy;
        _diagnostics.OutputEnergy += outputEnergy;
    }

    // Neither capture callback waits. Mic takes a bounded snapshot, so it
    // doesn't contend with the reference callback during the delay scan.
    internal void AddReference(ReadOnlySpan<byte> pcm, long? qpc)
    {
        if (!Monitor.TryEnter(_historyGate))
        {
            Interlocked.Increment(ref _historyRevision);
            return;
        }
        try
        {
            if (_paused || _stopped) return;
            if (_writtenRevision != Volatile.Read(ref _historyRevision)) InvalidateReference();
            if (!IsValidPacket(pcm, qpc))
            {
                InvalidateReference();
                return;
            }

            var time = qpc.GetValueOrDefault();
            var input = MemoryMarshal.Cast<byte, short>(pcm);
            if (!IsContinuous(time, _referenceTime, _referenceLength)) InvalidateReference();
            foreach (var sample in input)
            {
                var i = (int)(_head++ % _capacity);
                _reference[i] = sample;
                _reference[i + _capacity] = sample;
            }
            _referenceTime = time;
            _referenceLength = input.Length;
        }
        catch (Exception)
        {
            // No dependency on the filter for either transcription stream.
            InvalidateReference();
        }
        finally { Monitor.Exit(_historyGate); }
    }

    internal byte[] ProcessMic(byte[] pcm, long? qpc)
    {
        var input = MemoryMarshal.Cast<byte, short>(pcm.AsSpan());
        var blocks = input.Length == 0 ? 1 : (input.Length - 1) / _block + 1;
        if (!Monitor.TryEnter(_gate))
        {
            if (_state != Phase.Off) Interlocked.Add(ref _micBusyBlocks, blocks);
            return pcm;
        }
        var skipped = 0;
        try
        {
            if (_paused || _stopped) return pcm;
            if (!IsValidPacket(pcm, qpc))
            {
                Count(Outcome.InvalidMicPacket, blocks);
                if (pcm.Length % 2 == 0 && input.Length <= _rate / 10) MeasureMic(input, null);
                ResetMic();
                _micTime = 0;
                return pcm;
            }

            var time = qpc.GetValueOrDefault();
            var continuous = IsContinuous(time, _micTime, _micLength);
            _micTime = time;
            _micLength = input.Length;
            var snapshot = Outcome.MicDiscontinuity;
            var nominal = 0L;
            if (continuous) snapshot = TrySnapshot(time, out nominal);
            if (snapshot != Outcome.Filtered)
            {
                Count(snapshot, blocks);
                MeasureMic(input, null);
                ResetMic();
                return pcm;
            }
            byte[]? corrected = null;
            for (var offset = 0; offset < input.Length; offset += _block)
            {
                var count = Math.Min(_block, input.Length - offset);
                var mic = input.Slice(offset, count);
                // Keep only one rolling analysis block for short/partial
                // packets. Output only the new samples, without delaying Mic.
                var keep = Math.Min(_tailLength, _block - count);
                _micTail.AsSpan(_tailLength - keep, keep).CopyTo(_micTail);
                mic.CopyTo(_micTail.AsSpan(keep));
                _tailLength = keep + count;
                ReadOnlySpan<short> reference = default;
                double gain = 0;
                var outcome = _tailLength < _block ? Outcome.PartialBlock :
                    Predict(_micTail, nominal + offset - keep, count, out reference, out gain);
                if (outcome != Outcome.Filtered)
                {
                    Count(outcome);
                    skipped++;
                    continue;
                }
                corrected ??= (byte[])pcm.Clone();
                var output = MemoryMarshal.Cast<byte, short>(corrected.AsSpan()).Slice(offset, count);
                for (var i = 0; i < mic.Length; i++)
                    output[i] = (short)Math.Clamp(Math.Round(mic[i] - gain * reference[keep + i]), short.MinValue, short.MaxValue);
            }
            // A concurrent reference drop also invalidates this result. The
            // original Mic bytes have never been touched, even on exceptions.
            if (_readRevision == Volatile.Read(ref _historyRevision))
            {
                Count(Outcome.Filtered, blocks - skipped);
                MeasureMic(input, corrected);
                return corrected ?? pcm;
            }
            Count(Outcome.ReferenceChanged, blocks - skipped);
            MeasureMic(input, null);
            ResetMic();
            return pcm;
        }
        catch (Exception)
        {
            Count(Outcome.ProcessingError, blocks - skipped);
            MeasureMic(input, null);
            Interlocked.Increment(ref _historyRevision);
            ResetMic();
            return pcm;
        }
        finally { Monitor.Exit(_gate); }
    }

    internal void SetPaused(bool paused)
    {
        lock (_gate)
        lock (_historyGate)
        {
            if (_stopped || _paused == paused) return;
            _paused = paused;
            ClearHistory(paused ? Phase.Off : Phase.WarmingUp);
        }
    }

    internal void Stop()
    {
        lock (_gate)
        lock (_historyGate)
        {
            if (_stopped) return;
            _stopped = true;
            ClearHistory(Phase.Off);
            _reference = [];
            _snapshot = [];
            _micTail = [];
        }
    }

    private Outcome TrySnapshot(long time, out long nominal)
    {
        nominal = 0;
        if (!Monitor.TryEnter(_historyGate)) return Outcome.ReferenceSnapshotBusy;
        try
        {
            var revision = Volatile.Read(ref _historyRevision);
            var relativeTime = time - _referenceTime;
            if (_referenceTime == 0 || _writtenRevision != revision) return Outcome.ReferenceUnavailable;
            if (relativeTime is > TimeSpan.TicksPerMillisecond * 75 or < -TimeSpan.TicksPerMillisecond * 100)
                return Outcome.ReferenceTimestampOffset;
            if (_readRevision != revision)
            {
                ResetMic();
                _readRevision = revision;
            }
            // Anchor on the most recent reference packet's device timestamp,
            // not elapsed samples since session start: independent clocks drift.
            nominal = _head - _referenceLength + ToSamples(relativeTime);
            _snapshotLength = (int)Math.Min(_head, _capacity);
            _snapshotStart = _head - _snapshotLength;
            _reference.AsSpan((int)(_snapshotStart % _capacity), _snapshotLength).CopyTo(_snapshot);
            return Outcome.Filtered;
        }
        finally { Monitor.Exit(_historyGate); }
    }

    private Outcome Predict(ReadOnlySpan<short> mic, long nominal, int newSamples, out ReadOnlySpan<short> reference, out double gain)
    {
        reference = default;
        gain = 0;
        var active = _state == Phase.Active;
        if (_state == Phase.Bypass) _state = Phase.WarmingUp;

        // Search 20 ms ahead (clock/driver offsets) to 200 ms behind. Once
        // aligned, follow small changes rather than fitting to unrelated speech.
        var radius = _rate * 3 / 1000;
        var low = _matches == 0 ? -_rate / 50 : _delay - radius;
        var high = _matches == 0 ? _rate / 5 : _delay + radius;
        var from = Math.Max(nominal - high, _snapshotStart);
        var to = Math.Min(nominal - low, _snapshotStart + _snapshotLength - _block);
        double micPower = 0;
        foreach (var sample in mic)
        {
            if (sample is >= 32700 or <= -32700) return Outcome.MicClipped;
            micPower += (double)sample * sample;
        }
        if (micPower < mic.Length * 32 * 32) return Outcome.MicQuiet;
        if (from > to) return Outcome.ReferenceWindowUnavailable;
        _searchCooldown -= newSamples;
        if (_matches == 0)
        {
            if (_searchCooldown > 0) return Outcome.SearchCooldown;
            _searchCooldown = 4 * _block;
        }

        // Scan every possible lag with subsampled dot products; confirm the
        // winner using every sample. No per-candidate allocations.
        var best = -1L;
        var bestScore = 0.0;
        for (var start = from; start <= to; start++)
        {
            var candidate = ReferenceAt(start);
            var (cross, power) = Compare(mic, candidate, 4);
            if (power < mic.Length / 4 * 32 * 32) continue;
            var score = cross * cross / power;
            if (score > bestScore)
            {
                bestScore = score;
                best = start;
            }
        }
        var rejection = Outcome.NoReferenceMatch;
        if (best >= 0)
        {
            var candidate = ReferenceAt(best);
            var (cross, power) = Compare(mic, candidate, 1);
            var confidence = cross * cross / (power * micPower);
            var estimate = cross / power;
            var delay = (int)(nominal - best);
            _diagnostics.Candidate(delay, Math.Sqrt(confidence));
            if (!(confidence >= (active ? 0.65 * 0.65 : 0.84 * 0.84))) rejection = Outcome.LowCorrelation;
            else if (Math.Abs(estimate) is not (>= 0.03 and <= 1.25)) rejection = Outcome.GainOutOfRange;
            else if (_matches != 0 && estimate / _gain is not (>= 0.70 and <= 1.35)) rejection = Outcome.GainUnstable;
            else
            {
                _delay = delay;
                _misses = 0;
                // Freeze the gain on likely double talk; only subtract the
                // independently learned echo estimate, never duck the Mic mix.
                if (_matches == 0) _gain = estimate;
                else if (confidence >= 0.92 * 0.92) _gain += 0.10 * (estimate - _gain);
                if (!active)
                {
                    _matches += newSamples;
                    if (_matches >= 3 * _block) _state = Phase.Active;
                    return Outcome.WarmingUp;
                }
                reference = candidate;
                gain = 0.8 * _gain;
                return Outcome.Filtered;
            }
        }

        // Silence/near-only audio is not a missing reference. After enough
        // unmatched blocks reassess delay, but always pass these blocks intact.
        _misses += newSamples;
        if (!active || _misses >= 8 * _block) ResetMatch(Phase.WarmingUp);
        return rejection;
    }

    private ReadOnlySpan<short> ReferenceAt(long start) => _snapshot.AsSpan((int)(start - _snapshotStart), _block);

    private static (double Cross, double Power) Compare(ReadOnlySpan<short> mic, ReadOnlySpan<short> reference, int stride)
    {
        double cross = 0, power = 0;
        for (var i = 0; i < mic.Length; i += stride)
        {
            cross += (double)mic[i] * reference[i];
            power += (double)reference[i] * reference[i];
        }
        return (cross, power);
    }

    private bool IsValidPacket(ReadOnlySpan<byte> pcm, long? qpc) =>
        qpc is > 0 && pcm.Length != 0 && pcm.Length % 2 == 0 && pcm.Length / 2 <= _rate / 10;

    private long ToSamples(long ticks) => (long)Math.Round(ticks * ((double)_rate / TimeSpan.TicksPerSecond));

    private bool IsContinuous(long time, long previous, int count) => previous == 0 ||
        (time > previous && Math.Abs(ToSamples(time - previous) - count) <= _rate * 3 / 1000);

    private void ResetMic()
    {
        _searchCooldown = _tailLength = 0;
        ResetMatch(Phase.Bypass);
    }

    private void ResetMatch(Phase phase)
    {
        _matches = _misses = 0;
        _gain = 0;
        _state = phase;
    }

    private void InvalidateReference()
    {
        _referenceTime = _head = 0;
        _writtenRevision = Interlocked.Increment(ref _historyRevision);
    }

    private void ClearHistory(Phase phase)
    {
        Array.Clear(_reference);
        Array.Clear(_snapshot);
        Array.Clear(_micTail);
        InvalidateReference();
        _readRevision = _writtenRevision;
        _micTime = 0;
        ResetMic();
        _state = phase;
    }
}
