using System.Buffers.Binary;
using System.Diagnostics;
using System.Text.Json;
using MeetingNotes.Sidecar;
using NAudio.Wave;

internal static class BatchAudioValidation
{
    public static async Task RunAsync(Action<bool, string> check)
    {
        var directory = Directory.CreateTempSubdirectory();
        try
        {
            var epoch = 10 * Stopwatch.Frequency;
            long Arrived(int ms) => epoch + ms * Stopwatch.Frequency / 1000;
            long Qpc(int ms) => (10000L + ms) * TimeSpan.TicksPerMillisecond;
            var failures = new List<Exception>();
            void Failed(Exception ex) { lock (failures) failures.Add(ex); }
            var mic = new BatchAudioRecorder.WaveTrack(directory.FullName, "mic", Failed);
            var speaker = new BatchAudioRecorder.WaveTrack(directory.FullName, "speaker", Failed);
            var silent = new BatchAudioRecorder.WaveTrack(directory.FullName, "silent", Failed);
            var partial = new BatchAudioRecorder.WaveTrack(directory.FullName, "partial", Failed);
            check(!File.Exists(Path.Combine(directory.FullName, "recording.json")), "Opening tracks does not advertise a complete recording");

            // The packet clock, not delayed callback arrival, aligns both tracks. One packet crosses the epoch.
            mic.Enqueue(Pcm(32, 111), epoch, Arrived(20), Qpc(-1));
            mic.Enqueue(Pcm(16, 222), epoch, Arrived(55), Qpc(8));
            mic.Enqueue(Pcm(32, 333), epoch, Arrived(60), Qpc(8));
            speaker.Enqueue(Pcm(16, 444), epoch, Arrived(50), Qpc(8));
            speaker.Enqueue(Pcm(16, 555), epoch, Arrived(101), qpc100Ns: null);
            partial.Enqueue(Pcm(16, 666), epoch, Arrived(15), Qpc(0));
            var rejected = false;
            try { partial.Enqueue([1], epoch, Arrived(16), Qpc(0)); }
            catch (IOException) { rejected = true; }
            check(rejected, "Malformed partial sample is rejected");

            const int length = 2000;
            mic.Complete(length);
            speaker.Complete(length);
            silent.Complete(length);
            partial.Complete(null); // Failure cleanup closes what is available without inventing a successful tail.
            await Task.WhenAll(mic.Finished, speaker.Finished, silent.Finished, partial.Finished);
            check(failures.Count == 0, "Synthetic WAV writers finalized without errors");
            var micSamples = Read("mic");
            var speakerSamples = Read("speaker");
            var silentSamples = Read("silent");
            check(micSamples.Length == length && speakerSamples.Length == length && silentSamples.Length == length,
                "All selected tracks end on the same sample, including packetless loopback");
            check(Range(micSamples, 0, 16, 111) && Range(micSamples, 16, 128, 0) && Range(micSamples, 128, 144, 222) &&
                  Range(micSamples, 144, 160, 333) && Range(micSamples, 160, length, 0),
                "WAV trims pre-start and overlapped samples and writes leading, interior and trailing gaps correctly");
            check(Range(speakerSamples, 0, 128, 0) && Range(speakerSamples, 128, 144, 444) &&
                  Range(speakerSamples, 144, 1600, 0) && Range(speakerSamples, 1600, 1616, 555) &&
                  Range(speakerSamples, 1616, length, 0) && Range(silentSamples, 0, length, 0),
                "The two tracks share a timestamp, missing QPC falls back to arrival, and silence contains only zero samples");
            var partialSamples = Read("partial");
            check(partialSamples.SequenceEqual(Enumerable.Repeat((short)666, 16)) &&
                  !File.Exists(Path.Combine(directory.FullName, "recording.json")),
                "Failure cleanup keeps readable partial audio and does not publish a completion marker");

            var startedAt = new DateTimeOffset(2026, 11, 26, 12, 0, 0, TimeSpan.Zero);
            BatchAudioRecorder.PublishCompletion(directory.FullName, startedAt, ["mic", "speaker"]);
            using var marker = JsonDocument.Parse(File.ReadAllText(Path.Combine(directory.FullName, "recording.json")));
            check(marker.RootElement.GetProperty("startedAt").GetDateTimeOffset() == startedAt &&
                  marker.RootElement.GetProperty("sources").EnumerateArray().Select(s => s.GetString()).SequenceEqual(["mic", "speaker"]) &&
                  !File.Exists(Path.Combine(directory.FullName, "recording.json.tmp")), "Clean completion publishes the ISO timestamp and source list");

            short[] Read(string name)
            {
                using var reader = new WaveFileReader(Path.Combine(directory.FullName, name + ".wav"));
                var f = reader.WaveFormat;
                check(f.Encoding == WaveFormatEncoding.Pcm && f.SampleRate == 16000 && f.BitsPerSample == 16 && f.Channels == 1,
                    $"{name}.wav is PCM16 16 kHz mono");
                var bytes = new byte[reader.Length];
                reader.ReadExactly(bytes);
                return Enumerable.Range(0, bytes.Length / 2).Select(i => BinaryPrimitives.ReadInt16LittleEndian(bytes.AsSpan(i * 2))).ToArray();
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
