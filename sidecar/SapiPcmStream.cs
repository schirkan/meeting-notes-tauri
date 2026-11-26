using System.Diagnostics;

namespace MeetingNotes.Sidecar;

// System.Speech exposes this Stream as an IStream and snapshots Length when
// attaching it. Advertise a live length; Read returns EOF only at close.
internal sealed class SapiPcmStream : Stream
{
    public const int SampleRate = 16000;
    private const int BytesPerSecond = SampleRate * 2;
    private const int Quantum = BytesPerSecond / 50; // 20 ms mono PCM16
    private const int Capacity = BytesPerSecond * 2;
    private static readonly TimeSpan PacketGrace = TimeSpan.FromMilliseconds(80);
    private readonly object _gate = new();
    private readonly Queue<byte[]> _frames = new();
    private int _offset;
    private int _queued;
    private long _position;
    private long _idleSince;
    private long _silenceBytes;
    private bool _closed;
    private bool _discarded;

    // The capture callback transfers ownership. Never block it waiting for
    // the engine or silently drop an overrun: the caller fails the recording.
    public bool TryPush(byte[] frame)
    {
        lock (_gate)
        {
            if (_closed || frame.Length == 0) return true;
            if (frame.Length % 2 != 0 || frame.Length > Capacity - _queued) return false;
            _frames.Enqueue(frame);
            _queued += frame.Length;
            Monitor.PulseAll(_gate);
            return true;
        }
    }

    public void Finish(bool discard)
    {
        lock (_gate)
        {
            _closed = true;
            if (discard)
            {
                _discarded = true;
                _frames.Clear();
                _queued = 0;
                _offset = 0;
            }
            Monitor.PulseAll(_gate);
        }
    }

    public override int Read(byte[] buffer, int offset, int count)
    {
        ValidateBufferArguments(buffer, offset, count);
        lock (_gate)
        {
            var read = 0;
            while (read < count)
            {
                if (_frames.TryPeek(out var frame))
                {
                    var take = Math.Min(count - read, frame.Length - _offset);
                    frame.AsSpan(_offset, take).CopyTo(buffer.AsSpan(offset + read));
                    read += take;
                    _queued -= take;
                    _idleSince = Stopwatch.GetTimestamp();
                    _silenceBytes = 0;
                    _offset += take;
                    if (_offset == frame.Length)
                    {
                        _frames.Dequeue();
                        _offset = 0;
                    }
                    continue;
                }
                if (_closed) break;

                // WASAPI loopback emits no packets when nothing is playing.
                // Supply clock-paced zero PCM so native endpointing sees the
                // silence after speech, without treating idle as EOF.
                if (_idleSince == 0) _idleSince = Stopwatch.GetTimestamp();
                var silence = Math.Min(count - read, Quantum);
                var due = PacketGrace + TimeSpan.FromSeconds((double)(_silenceBytes + silence) / BytesPerSecond);
                while (!_closed && _queued == 0)
                {
                    var left = due - Stopwatch.GetElapsedTime(_idleSince);
                    if (left <= TimeSpan.Zero) break;
                    Monitor.Wait(_gate, Math.Max(1, (int)Math.Ceiling(left.TotalMilliseconds)));
                }
                if (_closed || _queued != 0) continue;
                buffer.AsSpan(offset + read, silence).Clear();
                read += silence;
                _silenceBytes += silence;
            }
            if (_discarded)
            {
                buffer.AsSpan(offset, read).Clear();
                return 0;
            }
            _position += read;
            return read;
        }
    }

    public override bool CanRead => true;
    public override bool CanSeek => false;
    public override bool CanWrite => false;
    public override long Length => long.MaxValue;
    public override long Position
    {
        get { lock (_gate) return _position; }
        set => Seek(value, SeekOrigin.Begin);
    }
    public override long Seek(long offset, SeekOrigin origin)
    {
        lock (_gate)
        {
            // Native IStream may query its current position even though live
            // input has no rewind or forward seek.
            if ((origin == SeekOrigin.Current && offset == 0) ||
                (origin == SeekOrigin.Begin && offset == _position)) return _position;
            throw new NotSupportedException("Live SAPI audio cannot seek.");
        }
    }
    public override void Flush() { }
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    protected override void Dispose(bool disposing)
    {
        if (disposing) Finish(discard: true);
        base.Dispose(disposing);
    }
}
