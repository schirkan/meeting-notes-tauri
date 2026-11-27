using System.Buffers.Binary;
using System.Diagnostics;
using MeetingNotes.Sidecar;
using NAudio.Wave;

internal static class BatchAudioValidation
{
    public static async Task RunAsync(Action<bool, string> check)
    {
        var directory = Directory.CreateTempSubdirectory();
        try
        {
            const string prefix = "20261127T162500000Z-dcf951b3-c40f-45d7-af7b-47d380df4cd2";
            const string otherPrefix = "20261127T162500000Z-c8d7e6ec-13b9-436b-9522-8dfa7f97daca";
            const long triggerMs = 1795796700000;
            check(BatchAudioRecorder.ParseRecordingPrefix(prefix) == prefix, "Canonical timestamp/UUID prefix is accepted");
            foreach (var invalid in new[] { null, "..\\" + prefix, prefix.Replace('Z', '/'), prefix.Replace("1127", "1131"), prefix[..^1] + ":" })
                Reject<ArgumentException>(() => BatchAudioRecorder.ParseRecordingPrefix(invalid), "Unsafe or malformed recording prefix is rejected");
            var nowTicks = 10 * Stopwatch.Frequency + 5 * Stopwatch.Frequency / 1000;
            var epoch = BatchAudioRecorder.CaptureEpoch(triggerMs, triggerMs + 5, nowTicks);
            check(epoch == 10 * Stopwatch.Frequency, "The UI trigger maps to the common QPC epoch before capture initialization");
            check(BatchAudioRecorder.CaptureEpoch(triggerMs + 1, triggerMs, nowTicks) == nowTicks, "Small future wall-clock skew is clamped");
            Reject<ArgumentException>(() => BatchAudioRecorder.CaptureEpoch(triggerMs - 300001, triggerMs, nowTicks), "Stale trigger cannot cause unbounded padding");
            Reject<ArgumentException>(() => BatchAudioRecorder.CaptureEpoch(triggerMs + 1001, triggerMs, nowTicks), "Invalid future trigger is rejected");
            long Arrived(int ms) => epoch + ms * Stopwatch.Frequency / 1000;
            long Qpc(int ms) => (10000L + ms) * TimeSpan.TicksPerMillisecond;
            var failures = new List<Exception>();
            void Failed(Exception ex) { lock (failures) failures.Add(ex); }
            var mic = new BatchAudioRecorder.WaveTrack(directory.FullName, prefix, "mic", Failed);
            var speaker = new BatchAudioRecorder.WaveTrack(directory.FullName, prefix, "speaker", Failed);
            var silent = new BatchAudioRecorder.WaveTrack(directory.FullName, otherPrefix, "speaker", Failed);
            var partial = new BatchAudioRecorder.WaveTrack(directory.FullName, otherPrefix, "mic", Failed);
            var micPath = $"{prefix}-mic.wav";
            var speakerPath = $"{prefix}-speaker.wav";
            BatchAudioRecorder.WaveTrack[] pair = [mic, speaker];
            check(!File.Exists(Full(micPath)) && !File.Exists(Full(speakerPath)) && File.Exists(Full(micPath + ".partial")),
                "Opening tracks exposes only .partial paths");
            Reject<IOException>(() => BatchAudioRecorder.WaveTrack.PublishAll(pair), "Open tracks cannot be published");
            Reject<IOException>(() => new BatchAudioRecorder.WaveTrack(directory.FullName, prefix, "mic", Failed),
                "A duplicate partial path cannot overwrite the open recording");

            // The packet clock, not delayed callback arrival, aligns both tracks. One packet crosses the epoch.
            mic.Enqueue(Pcm(32, 111), epoch, Arrived(20), Qpc(-1));
            mic.Enqueue(Pcm(16, 222), epoch, Arrived(55), Qpc(8));
            mic.Enqueue(Pcm(32, 333), epoch, Arrived(60), Qpc(8));
            speaker.Enqueue(Pcm(16, 444), epoch, Arrived(50), Qpc(8));
            speaker.Enqueue(Pcm(16, 555), epoch, Arrived(101), qpc100Ns: null);
            partial.Enqueue(Pcm(16, 666), epoch, Arrived(15), Qpc(0));
            Reject<IOException>(() => partial.Enqueue([1], epoch, Arrived(16), Qpc(0)), "Malformed partial sample is rejected");

            const int length = 2000;
            mic.Complete(length);
            speaker.Complete(length);
            silent.Complete(length);
            partial.Complete(null); // Failure cleanup closes what is available without inventing a successful tail.
            await Task.WhenAll(mic.Finished, speaker.Finished, silent.Finished, partial.Finished);
            check(failures.Count == 0, "Synthetic WAV writers finalized without errors");
            File.WriteAllText(Full(speakerPath), "existing");
            Reject<IOException>(() => BatchAudioRecorder.WaveTrack.PublishAll(pair), "A final WAV collision prevents publication");
            check(File.ReadAllText(Full(speakerPath)) == "existing" && File.Exists(Full(micPath + ".partial")) &&
                  File.Exists(Full(speakerPath + ".partial")) && !File.Exists(Full(micPath)),
                "The collision preserves the existing file and both partial WAVs");
            File.Delete(Full(speakerPath));
            BatchAudioRecorder.WaveTrack.PublishAll(pair);
            check(Directory.EnumerateFiles(directory.FullName, prefix + "*").Select(Path.GetFileName)
                    .Order(StringComparer.Ordinal).SequenceEqual([micPath, speakerPath]) &&
                  !Directory.EnumerateDirectories(directory.FullName).Any() &&
                  !Directory.EnumerateFiles(directory.FullName, "recording.json*").Any(),
                "Clean completion publishes exactly two flat timestamped WAVs without a manifest");
            var micSamples = Read(micPath);
            var speakerSamples = Read(speakerPath);
            var silentSamples = Read($"{otherPrefix}-speaker.wav.partial");
            check(micSamples.Length == length && speakerSamples.Length == length && silentSamples.Length == length,
                "All selected tracks end on the same sample, including packetless loopback");
            check(Range(micSamples, 0, 16, 111) && Range(micSamples, 16, 128, 0) && Range(micSamples, 128, 144, 222) &&
                  Range(micSamples, 144, 160, 333) && Range(micSamples, 160, length, 0),
                "WAV trims pre-start and overlapped samples and writes leading, interior and trailing gaps correctly");
            check(Range(speakerSamples, 0, 128, 0) && Range(speakerSamples, 128, 144, 444) &&
                  Range(speakerSamples, 144, 1600, 0) && Range(speakerSamples, 1600, 1616, 555) &&
                  Range(speakerSamples, 1616, length, 0) && Range(silentSamples, 0, length, 0),
                "The two tracks share a timestamp, missing QPC falls back to arrival, and silence contains only zero samples");
            var partialSamples = Read($"{otherPrefix}-mic.wav.partial");
            Reject<IOException>(() => BatchAudioRecorder.WaveTrack.PublishAll([silent, partial]), "An unclean stop cannot be published");
            check(partialSamples.SequenceEqual(Enumerable.Repeat((short)666, 16)) &&
                  !File.Exists(Full($"{otherPrefix}-mic.wav")) && !File.Exists(Full($"{otherPrefix}-speaker.wav")),
                "Failure cleanup keeps readable partial audio without publishing final paths");

            const string failedPrefix = "20261127T162500000Z-dcf951b3-c40f-45d7-af7b-47d380df4cd3";
            var failed = new BatchAudioRecorder.WaveTrack(directory.FullName, failedPrefix, "mic", Failed);
            failed.Complete(long.MaxValue); // Trigger the size guard before any padding is written.
            try { await failed.Finished; }
            catch (IOException) { }
            check(failed.Finished.IsFaulted && failures.Count == 1 && failures[0].Message.Contains("WAV size limit", StringComparison.Ordinal),
                "A writer failure is reported to the lifecycle owner");
            Reject<IOException>(() => BatchAudioRecorder.WaveTrack.PublishAll([failed]), "A failed writer cannot publish after a stop request");
            check(File.Exists(Full($"{failedPrefix}-mic.wav.partial")) && !File.Exists(Full($"{failedPrefix}-mic.wav")),
                "A writer failure preserves its partial path only");

            string Full(string name) => Path.Combine(directory.FullName, name);

            short[] Read(string name)
            {
                using var reader = new WaveFileReader(Full(name));
                var f = reader.WaveFormat;
                check(f.Encoding == WaveFormatEncoding.Pcm && f.SampleRate == 16000 && f.BitsPerSample == 16 && f.Channels == 1,
                    $"{name} is PCM16 16 kHz mono");
                var bytes = new byte[reader.Length];
                reader.ReadExactly(bytes);
                return Enumerable.Range(0, bytes.Length / 2).Select(i => BinaryPrimitives.ReadInt16LittleEndian(bytes.AsSpan(i * 2))).ToArray();
            }

            void Reject<T>(Action action, string description) where T : Exception
            {
                try { action(); }
                catch (T) { check(true, description); return; }
                check(false, description);
            }
        }
        finally { directory.Delete(recursive: true); }
    }

    private static byte[] Pcm(int samples, short value)
    {
        var bytes = new byte[samples * 2];
        for (var i = 0; i < samples; i++) BinaryPrimitives.WriteInt16LittleEndian(bytes.AsSpan(i * 2), value);
        return bytes;
    }

    private static bool Range(short[] samples, int start, int end, short value) =>
        samples.Length >= end && samples.AsSpan(start, end - start).IndexOfAnyExcept(value) < 0;
}
