using System.Diagnostics;
using System.Globalization;
using System.Threading.Channels;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace MeetingNotes.Sidecar;

internal static class BatchAudioRecorder
{
    private const int SampleRate = 16000;
    private const int SampleBytes = 2;
    private const long MaxStartAgeMs = 5 * 60 * 1000;
    private const long MaxFutureSkewMs = 1000;
    private static readonly WaveFormat Format = new(SampleRate, 16, 1);

    internal static async Task<int> RunAsync(IReadOnlyDictionary<string, string?> args)
    {
        Logger.Event("handshake", new
        {
            protocol_version = ProtocolVersion.Current,
            sidecar_version = typeof(BatchAudioRecorder).Assembly.GetName().Version?.ToString() ?? "0.0.0",
            capabilities = new[] { "batch_recording" }
        });

        string directory, prefix;
        long startUnixMs;
        TranscriptionSettings selected;
        try
        {
            directory = args.GetValueOrDefault("--record-batch") ?? "";
            if (!Path.IsPathFullyQualified(directory))
                throw new ArgumentException("--record-batch requires an absolute path to an existing recording directory.");
            directory = Path.TrimEndingDirectorySeparator(Path.GetFullPath(directory));
            selected = ArgsParser.ParseTranscription(args);
            if (!selected.Mic && !selected.Speaker)
                throw new ArgumentException("Select at least one audio source for batch recording.");
            if (!Directory.Exists(directory))
                throw new ArgumentException("The batch recording directory must already exist.");
            prefix = ParseRecordingPrefix(args.GetValueOrDefault("--recording-prefix"));
            if (!long.TryParse(args.GetValueOrDefault("--recording-start-unix-ms"), NumberStyles.None,
                CultureInfo.InvariantCulture, out startUnixMs))
                throw new ArgumentException("--recording-start-unix-ms requires a UTC epoch timestamp in milliseconds.");
        }
        catch (Exception ex)
        {
            Logger.Error("SIDECAR_START_FAILED", ex.Message);
            return 11;
        }

        var gate = new object();
        var stop = new TaskCompletionSource<long>(TaskCreationOptions.RunContinuationsAsynchronously);
        Exception? failure = null;
        var started = false;

        void Stop(Exception? error = null)
        {
            lock (gate)
            {
                failure ??= error;
                stop.TrySetResult(Stopwatch.GetTimestamp());
            }
        }

        async Task ReadCommandsAsync()
        {
            try
            {
                while (!stop.Task.IsCompleted)
                {
                    var line = await Console.In.ReadLineAsync();
                    if (stop.Task.IsCompleted) return;
                    if (line is null)
                    {
                        Stop(new IOException("The command stream closed before a batch stop was requested."));
                        return;
                    }
                    switch (SidecarCommands.ReadType(line))
                    {
                        case SidecarCommands.HandshakeAck:
                            Logger.Info("sidecar", "handshake_ack", "Protocol handshake confirmed.");
                            break;
                        case SidecarCommands.Shutdown:
                            Stop();
                            return;
                        case SidecarCommands.Pause:
                        case SidecarCommands.Resume:
                            Logger.Warn("sidecar", "batch_pause_unsupported", "Batch recording cannot be paused or resumed. Use Stop to end capture.");
                            break;
                    }
                }
            }
            catch (Exception ex) { Stop(ex); }
        }

        async Task<List<WaveTrack>> CaptureAsync()
        {
            // Map the UI/auto trigger to QPC before device enumeration and WASAPI initialization.
            var nowUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var epoch = CaptureEpoch(startUnixMs, nowUnixMs, Stopwatch.GetTimestamp());
            var tracks = new List<WaveTrack>();
            var recorders = new List<AudioRecorderSource>();
            using var devices = new MMDeviceEnumerator();
            using var mic = selected.Mic ? DeviceResolver.ResolveInputDevice(devices, args.GetValueOrDefault("--mic-device-id"))
                ?? throw new InvalidOperationException("No microphone device found.") : null;
            using var speaker = selected.Speaker ? DeviceResolver.ResolveOutputDevice(devices, args.GetValueOrDefault("--speaker-device-id"))
                ?? throw new InvalidOperationException("No speaker device for loopback found.") : null;
            long? endSample = null;

            void AddTrack(string name, MMDevice device, bool loopback)
            {
                var track = new WaveTrack(directory, prefix, name, Stop);
                tracks.Add(track);
                var recorder = AudioRecorderSource.Create(device, loopback, Format, name, includePacketTimestamp: true,
                    (pcm, received, _, qpc) =>
                    {
                        lock (gate)
                        {
                            if (!stop.Task.IsCompleted) track.Enqueue(pcm, epoch, received, qpc);
                        }
                    });
                recorder.CaptureFailed += ex => Stop(new IOException($"Batch capture failed ({name}): {ex.Message}", ex));
                recorders.Add(recorder);
            }

            try
            {
                if (stop.Task.IsCompleted) throw new IOException("Batch recording was stopped before capture started.");
                if (mic is not null) AddTrack("mic", mic, loopback: false);
                if (speaker is not null) AddTrack("speaker", speaker, loopback: true);
                foreach (var recorder in recorders)
                {
                    if (stop.Task.IsCompleted) break;
                    recorder.Start();
                }
                lock (gate)
                {
                    if (!stop.Task.IsCompleted)
                    {
                        Volatile.Write(ref started, true);
                        Logger.Event("status", new { phase = "started", running = true });
                    }
                }
                var stopTicks = await stop.Task;
                lock (gate)
                {
                    if (started && failure is null) endSample = ElapsedSamples(epoch, stopTicks);
                }
            }
            finally
            {
                // Seal callback admission on startup exceptions too, before releasing native resources.
                Stop();
                try
                {
                    foreach (var recorder in recorders) recorder.Stop();
                    foreach (var recorder in recorders)
                    {
                        try { recorder.Dispose(); }
                        catch (Exception ex) { Stop(ex); }
                    }
                }
                finally
                {
                    lock (gate)
                    {
                        foreach (var track in tracks) track.Complete(failure is null ? endSample : null);
                    }
                    await Task.WhenAll(tracks.Select(track => track.Finished));
                }
            }
            lock (gate)
            {
                if (failure is not null) throw failure;
                if (endSample is null) throw new IOException("Batch recording was stopped before capture started.");
            }
            return tracks;
        }

        ConsoleCancelEventHandler onCancel = (_, e) => { e.Cancel = true; Stop(); };
        Console.CancelKeyPress += onCancel;
        try
        {
            _ = Task.Run(ReadCommandsAsync);
            var owner = Task.Run(CaptureAsync);
            _ = owner.ContinueWith(task => { _ = task.Exception; }, TaskContinuationOptions.OnlyOnFaulted);
            await Task.WhenAny(owner, stop.Task);
            var tracks = await owner.WaitAsync(RecordingControl.ShutdownBudget);
            // Only the lifecycle owner publishes WAVs, never a late cleanup worker.
            WaveTrack.PublishAll(tracks);
            Logger.Stopped();
            return 0;
        }
        catch (TimeoutException)
        {
            Logger.Error("SIDECAR_UNAVAILABLE", "Timed out finishing batch recording; the audio files may be incomplete.");
            return 50;
        }
        catch (Exception ex)
        {
            Logger.Error(Volatile.Read(ref started) ? "SIDECAR_UNAVAILABLE" : "SIDECAR_START_FAILED", ex.Message);
            return 50;
        }
        finally
        {
            Stop();
            Console.CancelKeyPress -= onCancel;
        }
    }

    internal static string ParseRecordingPrefix(string? prefix)
    {
        const int timestampLength = 19; // yyyyMMddTHHmmssfffZ
        if (prefix is null || prefix.Length != timestampLength + 1 + 36 || prefix[timestampLength] != '-' ||
            !DateTime.TryParseExact(prefix.AsSpan(0, timestampLength), "yyyyMMdd'T'HHmmssfff'Z'",
                CultureInfo.InvariantCulture, DateTimeStyles.None, out _) ||
            !Guid.TryParseExact(prefix.AsSpan(timestampLength + 1), "D", out _))
            throw new ArgumentException("--recording-prefix requires yyyyMMddTHHmmssfffZ-<UUID>.");
        return prefix;
    }

    internal static long CaptureEpoch(long startUnixMs, long nowUnixMs, long nowTicks)
    {
        if (startUnixMs <= 0 || nowUnixMs - startUnixMs is > MaxStartAgeMs or < -MaxFutureSkewMs)
            throw new ArgumentException("--recording-start-unix-ms must be no more than five minutes old or one second ahead.");
        var elapsedMs = Math.Max(0, nowUnixMs - startUnixMs);
        return nowTicks - elapsedMs * Stopwatch.Frequency / 1000;
    }

    private static long ElapsedSamples(long epoch, long ticks) =>
        (long)Math.Round((ticks - epoch) * (SampleRate / (double)Stopwatch.Frequency));

    internal sealed class WaveTrack
    {
        // At most 256 packets, each at most 128 KiB; never block a WASAPI callback on disk I/O.
        private const int MaxPacketBytes = 128 * 1024;
        private const long MaxSamples = (uint.MaxValue - 64L) / SampleBytes;
        private readonly Channel<(byte[] Pcm, long Start)> _packets = Channel.CreateBounded<(byte[], long)>(
            new BoundedChannelOptions(256) { SingleReader = true, SingleWriter = true });
        private readonly string _finalPath;
        private readonly string _partialPath;
        private long? _endSample;
        private long _lastEnqueuedEnd;

        internal WaveTrack(string directory, string prefix, string name, Action<Exception> failed)
        {
            var filename = $"{prefix}-{name}.wav";
            _finalPath = Path.Combine(directory, filename);
            _partialPath = _finalPath + ".partial";
            var stream = new FileStream(_partialPath, FileMode.CreateNew, FileAccess.Write, FileShare.Read);
            WaveFileWriter writer;
            try { writer = new WaveFileWriter(stream, Format); }
            catch { stream.Dispose(); throw; }
            Finished = Task.Run(async () =>
            {
                try
                {
                    using (stream)
                    using (writer)
                    {
                        await WriteAsync(writer);
                        writer.Flush();
                        stream.Flush(flushToDisk: true);
                    }
                }
                catch (Exception ex)
                {
                    var error = new IOException($"Could not write {filename}: {ex.Message}", ex);
                    failed(error);
                    throw error;
                }
            });
        }

        internal Task Finished { get; }

        internal static void PublishAll(IReadOnlyList<WaveTrack> tracks)
        {
            foreach (var track in tracks)
            {
                if (!track.Finished.IsCompletedSuccessfully || track._endSample is null)
                    throw new IOException("Cannot publish a batch WAV before a clean stop has closed it.");
                if (Path.Exists(track._finalPath))
                    throw new IOException($"The recording file already exists: {Path.GetFileName(track._finalPath)}");
            }
            foreach (var track in tracks)
                File.Move(track._partialPath, track._finalPath, overwrite: false);
        }

        internal void Enqueue(byte[] pcm, long epoch, long received, long? qpc100Ns)
        {
            if (pcm.Length == 0) return;
            if (pcm.Length > MaxPacketBytes || pcm.Length % SampleBytes != 0)
                throw new IOException("Invalid batch PCM packet size.");

            var count = pcm.Length / SampleBytes;
            var latestStart = ElapsedSamples(epoch, received) - count;
            // The WASAPI timestamp and Stopwatch are the same QPC clock expressed in different units.
            // Invalid/resampler timestamps fall back to arrival, preferring continuity across a packet of jitter.
            var start = latestStart;
            if (qpc100Ns is > 0)
            {
                var packetStart = (long)Math.Round(qpc100Ns.Value * (SampleRate / (double)TimeSpan.TicksPerSecond)
                    - epoch * (SampleRate / (double)Stopwatch.Frequency));
                start = Math.Min(latestStart, packetStart);
            }
            else if (_lastEnqueuedEnd > 0 && latestStart - _lastEnqueuedEnd is >= 0 && latestStart - _lastEnqueuedEnd <= count)
            {
                start = _lastEnqueuedEnd;
            }
            _lastEnqueuedEnd = Math.Max(_lastEnqueuedEnd, start + count);
            if (!_packets.Writer.TryWrite((pcm, start)))
                throw new IOException("The batch audio writer cannot keep up with capture.");
        }

        internal void Complete(long? endSample)
        {
            _endSample = endSample;
            _packets.Writer.Complete();
        }

        private async Task WriteAsync(WaveFileWriter writer)
        {
            var zeros = new byte[64 * 1024];
            long written = 0;
            var checkpoint = Stopwatch.GetTimestamp();

            void PadTo(long sample)
            {
                if (sample > MaxSamples) throw new IOException("The recording exceeds the WAV size limit.");
                while (written < sample)
                {
                    var count = (int)Math.Min(sample - written, zeros.Length / SampleBytes);
                    writer.Write(zeros, 0, count * SampleBytes);
                    written += count;
                }
            }

            await foreach (var (pcm, start) in _packets.Reader.ReadAllAsync())
            {
                var end = start + pcm.Length / SampleBytes;
                if (end <= written) continue; // Before the common epoch, or entirely overlapped.
                if (end > MaxSamples) throw new IOException("The recording exceeds the WAV size limit.");
                PadTo(start);
                writer.Write(pcm, (int)(written - start) * SampleBytes, (int)(end - written) * SampleBytes);
                written = end;
                if (Stopwatch.GetElapsedTime(checkpoint) >= TimeSpan.FromSeconds(5))
                {
                    writer.Flush(); // Keep a readable checkpoint even if the host is forced to terminate.
                    checkpoint = Stopwatch.GetTimestamp();
                }
            }
            if (_endSample is long stopSample) PadTo(stopSample);
        }
    }
}
