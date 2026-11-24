using System.Diagnostics;

namespace MeetingNotes.Sidecar;

internal sealed class StereoAudioMux
{
    internal const int SampleRate = 16000;
    internal const int BlockSamples = 320;
    internal const int MaxBlocks = 50;
    internal static readonly TimeSpan Hold = TimeSpan.FromMilliseconds(80);
    private readonly SortedDictionary<long, Block> _blocks = new();
    private long _next = long.MinValue;
    private readonly long _holdTicks;
    public long DroppedSamples { get; private set; }
    public long PaddedSamples { get; private set; }
    public long EstimatedFrames { get; private set; }

    internal StereoAudioMux(long clockFrequency) => _holdTicks = clockFrequency * (long)Hold.TotalMilliseconds / 1000;

    private sealed class Block(long receivedAt)
    {
        internal readonly byte[] Pcm = new byte[BlockSamples * 4];
        internal readonly bool[] Present = new bool[BlockSamples * 2];
        internal readonly long ReceivedAt = receivedAt;
        internal int Filled;
        internal int LastSample;
    }

    internal void Add(int channel, ReadOnlySpan<byte> pcm, long start, long receivedAt, bool estimated)
    {
        if (estimated) EstimatedFrames++;
        var samples = pcm.Length / 2;
        for (var offset = 0; offset < samples;)
        {
            var sample = start + offset;
            var blockId = Math.DivRem(sample, BlockSamples, out var position);
            if (position < 0) { blockId--; position += BlockSamples; }
            var count = Math.Min(samples - offset, BlockSamples - (int)position);
            if (blockId < _next || (!_blocks.ContainsKey(blockId) && _blocks.Count >= MaxBlocks))
            {
                DroppedSamples += count;
                offset += count;
                continue;
            }
            if (!_blocks.TryGetValue(blockId, out var block))
                _blocks.Add(blockId, block = new Block(receivedAt));
            for (var i = 0; i < count; i++, offset++, position++)
            {
                var slot = (int)position * 2 + channel;
                if (block.Present[slot]) { DroppedSamples++; continue; }
                block.Present[slot] = true;
                block.Filled++;
                block.LastSample = Math.Max(block.LastSample, (int)position + 1);
                pcm.Slice(offset * 2, 2).CopyTo(block.Pcm.AsSpan(slot * 2, 2));
            }
        }
    }

    internal byte[]? Take(long now, bool drain = false)
    {
        if (_blocks.Count == 0) return null;
        var (id, block) = _blocks.First();
        if (!drain && block.Filled < BlockSamples * 2 && now - block.ReceivedAt < _holdTicks) return null;
        _next = id + 1;
        _blocks.Remove(id);
        // Do not extend the final packet past the last captured sample.
        var length = drain && _blocks.Count == 0 ? block.LastSample : BlockSamples;
        PaddedSamples += length * 2 - block.Filled;
        return length == BlockSamples ? block.Pcm : block.Pcm[..(length * 4)];
    }

    internal void Reset()
    {
        _blocks.Clear();
        _next = long.MinValue;
    }
}

internal sealed class StereoAudioWriter
{
    private readonly StereoAudioMux _mux = new(Stopwatch.Frequency);
    private readonly object _queueGate = new();
    private readonly object _writeGate = new();
    private readonly Task _worker;
    private bool _paused;
    private bool _completed;
    private long _resumeTicks;

    internal StereoAudioWriter(Action<byte[]> write, Action<Exception> failed)
    {
        _worker = Task.Run(async () =>
        {
            try
            {
                while (true)
                {
                    bool done;
                    lock (_writeGate)
                    {
                        byte[]? pcm;
                        lock (_queueGate)
                        {
                            pcm = _mux.Take(Stopwatch.GetTimestamp(), _completed);
                            done = _completed && pcm is null;
                        }
                        if (pcm is not null) write(pcm);
                        if (done) break;
                        if (pcm is not null) continue;
                    }
                    await Task.Delay(5);
                }
            }
            catch (Exception ex)
            {
                lock (_queueGate) _completed = true;
                failed(ex);
            }
        });
    }

    internal void Add(AudioFrame frame)
    {
        if (frame.Payload.Length == 0 || frame.Payload.Length % 2 != 0 ||
            frame.SampleRate != StereoAudioMux.SampleRate || frame.BitsPerSample != 16 || frame.Channels != 1) return;
        var channel = frame.Source switch { "mic" => 0, "speaker" => 1, _ => -1 };
        if (channel < 0) return;
        var received = Stopwatch.GetTimestamp();
        // A degraded estimate is only used when WASAPI or resampling cannot supply a reliable packet start.
        var estimated = frame.PacketQpc100Ns is null;
        var start = frame.PacketQpc100Ns is { } qpc
            ? (long)Math.Round(qpc * (StereoAudioMux.SampleRate / 10_000_000.0))
            : (long)Math.Round((frame.CapturedAtTicks > 0 ? frame.CapturedAtTicks : received) *
                (StereoAudioMux.SampleRate / (double)Stopwatch.Frequency)) - frame.Payload.Length / 2;
        lock (_queueGate)
        {
            if (_paused || _completed || (frame.CapturedAtTicks > 0 && frame.CapturedAtTicks < _resumeTicks)) return;
            // Clip packets captured across the resume boundary using the common QPC clock.
            var first = _resumeTicks == 0 ? start : Math.Max(start,
                (long)Math.Ceiling(_resumeTicks * (StereoAudioMux.SampleRate / (double)Stopwatch.Frequency)));
            if (first - start >= frame.Payload.Length / 2) return;
            _mux.Add(channel, frame.Payload.AsSpan((int)(first - start) * 2), first, received, estimated);
        }
    }

    internal void SetPaused(bool paused)
    {
        lock (_writeGate)
        lock (_queueGate)
        {
            if (_completed || _paused == paused) return;
            _paused = paused;
            _mux.Reset();
            if (!paused) _resumeTicks = Stopwatch.GetTimestamp();
        }
    }

    internal async Task CompleteAsync()
    {
        lock (_queueGate) _completed = true;
        await _worker;
        Logger.Info("audio", "stereo_mux", $"Stereo samples: padded={_mux.PaddedSamples}, dropped={_mux.DroppedSamples}, estimatedPackets={_mux.EstimatedFrames}.");
    }
}
