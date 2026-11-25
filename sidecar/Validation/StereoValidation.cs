using System.Buffers.Binary;
using Microsoft.CognitiveServices.Speech;
using MeetingNotes.Sidecar;

internal static class StereoValidation
{
    private static byte[] Pcm(short value, int samples)
    {
        var bytes = new byte[samples * 2];
        for (var i = 0; i < bytes.Length; i += 2) BinaryPrimitives.WriteInt16LittleEndian(bytes.AsSpan(i), value);
        return bytes;
    }

    internal static async Task RunAsync(Action<bool, string> check)
    {
        var mux = new StereoAudioMux(1000);
        mux.Add(1, Pcm(-513, 318), 2, 0, false);
        mux.Add(0, Pcm(258, 150), 0, 3, false);
        mux.Add(0, Pcm(514, 171), 149, 7, false);
        check(mux.Take(79) is null, "An incomplete stereo block waits for its counterpart");
        var block = mux.Take(80)!;
        check(block.AsSpan(0, 12).SequenceEqual(new byte[] { 2, 1, 0, 0, 2, 1, 0, 0, 2, 1, 255, 253 }),
            "Different packet offsets preserve mic-first, little-endian interleaving and pad the missing samples");
        check(block.AsSpan(149 * 4, 8).SequenceEqual(new byte[] { 2, 1, 255, 253, 2, 2, 255, 253 }),
            "Overlapping samples do not replace accepted data");
        mux.Add(1, Pcm(1, 320), 0, 80, false);
        check(mux.Take(160) is null && mux.DroppedSamples == 321 && mux.PaddedSamples == 2,
            "Late packets cannot recreate emitted blocks");

        mux.Add(1, Pcm(-513, 1), 320 * 5000 + 1, 160, true);
        var tail = mux.Take(160, drain: true)!;
        check(tail.SequenceEqual(new byte[] { 0, 0, 0, 0, 0, 0, 255, 253 }) && mux.Take(161, drain: true) is null,
            "Drain skips empty intervals and emits a partial tail once without trailing silence");

        mux.Reset();
        mux.Add(0, Pcm(1, 320 * 51), 0, 0, false);
        var drained = 0;
        while (mux.Take(0, drain: true) is { } pcm) drained += pcm.Length;
        check(drained == 320 * 4 * 50 && mux.DroppedSamples == 641, "The stereo queue bounds a one-sided burst");
        mux.Reset();
        mux.Add(0, Pcm(1, 320), 0, 0, false);
        mux.Add(1, Pcm(2, 320), 0, 1, false);
        check(mux.Take(1) is { Length: 1280 }, "A complete stereo block is ready without waiting for the hold timer");

        var writes = new List<byte[]>();
        var failed = false;
        var frequency = System.Diagnostics.Stopwatch.Frequency;
        var now = frequency;
        var writer = new StereoAudioWriter(writes.Add, _ => failed = true, () => Volatile.Read(ref now));
        writer.SetPaused(true);
        writer.Add(new AudioFrame("mic", 16000, 16, 1, Pcm(1, 640)));
        writer.SetPaused(false);
        Volatile.Write(ref now, 2 * frequency);
        writer.Add(new AudioFrame("mic", 16000, 16, 1, Pcm(13, 5), PacketQpc100Ns: 1));
        // Callback arrives long after Resume: the fallback estimate places the whole packet after Resume,
        // but the packet could contain audio buffered while paused (with or without a callback timestamp).
        writer.Add(new AudioFrame("mic", 16000, 16, 1, Pcm(11, 10), CapturedAtTicks: now));
        writer.Add(new AudioFrame("speaker", 16000, 16, 1, Pcm(12, 10)));
        writer.Add(new AudioFrame("mic", 16000, 16, 1, [.. Pcm(23, 5), .. Pcm(3, 5)],
            PacketQpc100Ns: TimeSpan.TicksPerSecond - 5 * 625));
        writer.Add(new AudioFrame("speaker", 16000, 16, 1, Pcm(2, 10), PacketQpc100Ns: TimeSpan.TicksPerSecond));
        await writer.CompleteAsync().WaitAsync(TimeSpan.FromSeconds(5));
        var samples = writes.SelectMany(bytes => bytes).Chunk(4).ToArray();
        check(!failed && samples.All(sample => (sample[0] is 0 or 3) && (sample[2] is 0 or 2)) &&
            samples.Count(sample => sample[0] == 3) == 5 && samples.Count(sample => sample[2] == 2) == 10,
            "Stereo Resume rejects delayed packets without QPC and clips trusted packets at the capture-time boundary");

        writes.Clear();
        var uninterrupted = new StereoAudioWriter(writes.Add, _ => failed = true, () => Volatile.Read(ref now));
        uninterrupted.Add(new AudioFrame("mic", 16000, 16, 1, Pcm(11, 10), CapturedAtTicks: now));
        await uninterrupted.CompleteAsync().WaitAsync(TimeSpan.FromSeconds(5));
        check(!failed && writes.SelectMany(bytes => bytes).Chunk(4).Count(sample => sample[0] == 11) == 10,
            "Before any pause, Stereo can still use estimated timing for audio without QPC");

        foreach (var (index, json, source) in new (int, string, string?)[]
        {
            (0, "{\"Channel\":0}", "mic"), (1, "{\"Channel\":1}", "speaker"),
            (0, "{}", null), (0, "{\"Channel\":1}", null), (1, "{\"Channel\":\"1\"}", null),
            (-1, "{\"Channel\":-1}", null), (2, "{\"Channel\":2}", null), (0, "invalid", null)
        })
            check(AzureSpeechService.ResolveStereoSource(index, json) == source, $"Route channel {index} with metadata {json}");

        var standard = new AzureSpeechConfig("wss://localhost/speech/universal/v2", "swedencentral", "validation-key", true, null);
        var user = new UserSettings("de-DE", new DeviceIds(null, null)) { Stereo = true, Diarization = new(false, true) };
        using var standardService = new AzureSpeechService(standard, user);
        check(standardService.IsStereo && standardService.GetRecognitionMode("stereo") == "conversationTranscriber",
            "Standard shares one conversation transcriber when either stereo channel requests diarization");
        using var withoutDiarization = new AzureSpeechService(standard, user with { Diarization = new(false, false) });
        check(withoutDiarization.GetRecognitionMode("stereo") == "speechRecognizer", "Standard stereo without diarization uses a speech recognizer");
        using var singleSource = new AzureSpeechService(standard, user with { Transcription = new(true, false) });
        check(!singleSource.IsStereo && singleSource.TranscriptionSources.SequenceEqual(new[] { "mic" }), "A stereo preference with only one source uses mono");
        var mai = standard with { Model = AzureSpeechModel.MaiTranscribe2Streaming };
        try
        {
            SpeechConfiguration.Create(mai, user.Language, stereo: true);
            check(false, "MAI stereo must not reach the SDK");
        }
        catch (ArgumentException) { check(true, "MAI stereo is rejected before configuring the SDK"); }
    }
}
