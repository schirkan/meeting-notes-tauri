using System.Runtime.InteropServices;

namespace MeetingNotes.Sidecar;

/// <summary>Opt-in Alpha: one delayed, scaled loopback tap, not a room impulse model.</summary>
internal sealed class EchoCancellation
{
    internal enum Phase { WarmingUp, Active, Bypass, Off }

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
        if (!Monitor.TryEnter(_gate)) return pcm;
        try
        {
            if (_paused || _stopped) return pcm;
            if (!IsValidPacket(pcm, qpc))
            {
                ResetMic();
                _micTime = 0;
                return pcm;
            }

            var time = qpc.GetValueOrDefault();
            var input = MemoryMarshal.Cast<byte, short>(pcm.AsSpan());
            var continuous = IsContinuous(time, _micTime, _micLength);
            _micTime = time;
            _micLength = input.Length;
            if (!continuous || !TrySnapshot(time, out var nominal))
            {
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
                if (_tailLength < _block || !TryPredict(_micTail, nominal + offset - keep, count, out var reference, out var gain))
                    continue;
                corrected ??= (byte[])pcm.Clone();
                var output = MemoryMarshal.Cast<byte, short>(corrected.AsSpan()).Slice(offset, count);
                for (var i = 0; i < mic.Length; i++)
                    output[i] = (short)Math.Clamp(Math.Round(mic[i] - gain * reference[keep + i]), short.MinValue, short.MaxValue);
            }
            // A concurrent reference drop also invalidates this result. The
            // original Mic bytes have never been touched, even on exceptions.
            if (_readRevision == Volatile.Read(ref _historyRevision)) return corrected ?? pcm;
            ResetMic();
            return pcm;
        }
        catch (Exception)
        {
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

    private bool TrySnapshot(long time, out long nominal)
    {
        nominal = 0;
        if (!Monitor.TryEnter(_historyGate)) return false;
        try
        {
            var revision = Volatile.Read(ref _historyRevision);
            var relativeTime = time - _referenceTime;
            if (_referenceTime == 0 || _writtenRevision != revision ||
                relativeTime is > TimeSpan.TicksPerMillisecond * 75 or < -TimeSpan.TicksPerMillisecond * 100)
                return false;
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
            return true;
        }
        finally { Monitor.Exit(_historyGate); }
    }

    private bool TryPredict(ReadOnlySpan<short> mic, long nominal, int newSamples, out ReadOnlySpan<short> reference, out double gain)
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
            if (sample is >= 32700 or <= -32700) return false;
            micPower += (double)sample * sample;
        }
        if (micPower < mic.Length * 32 * 32 || from > to) return false;
        _searchCooldown -= newSamples;
        if (_matches == 0)
        {
            if (_searchCooldown > 0) return false;
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
        if (best >= 0)
        {
            var candidate = ReferenceAt(best);
            var (cross, power) = Compare(mic, candidate, 1);
            var confidence = cross * cross / (power * micPower);
            var estimate = cross / power;
            if (confidence >= (active ? 0.65 * 0.65 : 0.84 * 0.84) && Math.Abs(estimate) is >= 0.03 and <= 1.25 &&
                (_matches == 0 || estimate / _gain is >= 0.70 and <= 1.35))
            {
                _delay = (int)(nominal - best);
                _misses = 0;
                // Freeze the gain on likely double talk; only subtract the
                // independently learned echo estimate, never duck the Mic mix.
                if (_matches == 0) _gain = estimate;
                else if (confidence >= 0.92 * 0.92) _gain += 0.10 * (estimate - _gain);
                if (!active)
                {
                    _matches += newSamples;
                    if (_matches >= 3 * _block) _state = Phase.Active;
                    return false;
                }
                reference = candidate;
                gain = 0.8 * _gain;
                return true;
            }
        }

        // Silence/near-only audio is not a missing reference. After enough
        // unmatched blocks reassess delay, but always pass these blocks intact.
        _misses += newSamples;
        if (!active || _misses >= 8 * _block) ResetMatch(Phase.WarmingUp);
        return false;
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
