using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.Speech.Recognition;
using System.Speech.Synthesis;
using System.Text.Json;
using MeetingNotes.Sidecar;

internal static class SapiValidation
{
    public static void Run(Action<bool, string> check)
    {
        using var mic = new SapiPcmStream();
        using var speaker = new SapiPcmStream();
        check(mic.Length == long.MaxValue && mic.Position == 0, "SAPI IStream has live length and an initial position");
        check(mic.TryPush([1, 2, 3, 4]) && mic.TryPush([5, 6]), "Mic packets can be queued");
        check(speaker.TryPush([7, 8]), "Speaker packets have a separate queue");
        check(!mic.TryPush(new byte[64000]) && !mic.TryPush([1]), "Backpressure and invalid PCM are reported");
        mic.Finish(discard: false);
        var read = new byte[8];
        check(mic.Read(read, 0, 2) == 2 && read[..2].SequenceEqual(new byte[] { 1, 2 }), "Stop drains the first part of a frame");
        check(mic.Read(read, 0, 8) == 4 && read[..4].SequenceEqual(new byte[] { 3, 4, 5, 6 }), "Stop preserves queued byte order then reaches EOF");
        check(mic.Read(read, 0, 2) == 0 && mic.Seek(0, SeekOrigin.Current) == 6, "Stop reports EOF with correct sample position");
        speaker.Finish(discard: true);
        check(speaker.TryPush([9, 10]) && speaker.Read(read, 0, 2) == 0, "Pause discards both queued and late callbacks from the old capture");
        using var resumed = new SapiPcmStream();
        check(resumed.TryPush([11, 12]) && resumed.Read(read, 0, 2) == 2 && read[..2].SequenceEqual(new byte[] { 11, 12 }), "Resume consumes only the new generation");
        read[0] = 99;
        check(resumed.Read(read, 0, 2) == 2 && read[0] == 0, "Idle loopback supplies PCM silence, not EOF");
    }

    public static async Task RunBinaryAsync(string executable, Action<ProcessStartInfo> configure, Action<bool, string> check)
    {
        async Task<(int Exit, JsonElement[] Events)> Run(params string[] args)
        {
            var start = new ProcessStartInfo(executable)
            {
                UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true,
                RedirectStandardOutput = true, RedirectStandardError = true
            };
            foreach (var arg in args) start.ArgumentList.Add(arg);
            configure(start);
            using var process = Process.Start(start)!;
            try
            {
                var output = process.StandardOutput.ReadToEndAsync();
                var errors = process.StandardError.ReadToEndAsync();
                await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(20));
                check(string.IsNullOrEmpty(await errors), "SAPI sidecar has no stderr failure");
                var events = (await output).Split('\n', StringSplitOptions.RemoveEmptyEntries).Select(line =>
                {
                    using var json = JsonDocument.Parse(line);
                    return json.RootElement.Clone();
                }).ToArray();
                return (process.ExitCode, events);
            }
            finally { if (!process.HasExited) process.Kill(true); }
        }

        var probe = await Run("--test-sapi", "--language", "en-GB");
        check(probe.Events.Length == 1 && probe.Events[0].GetProperty("type").GetString() == "sapi_probe", "Probe emits one sapi_probe and no capture handshake");
        var payload = probe.Events[0].GetProperty("payload");
        check(probe.Exit == (payload.GetProperty("ready").GetBoolean() ? 0 : 1) &&
            !string.IsNullOrWhiteSpace(payload.GetProperty("detail").GetString()), "Probe result matches exit code and supplies detail");
        var unavailable = await Run("--test-sapi", "--language", "en-XX");
        check(unavailable.Exit == 1 && !unavailable.Events.Single().GetProperty("payload").GetProperty("ready").GetBoolean(),
            "SAPI does not fall back to another English culture");
        var recording = await Run("--recognition-provider", "windows-sapi", "--language", "en-XX", "--interim-results", "false");
        check(recording.Exit != 0 && recording.Events[0].GetProperty("type").GetString() == "handshake" &&
            recording.Events[0].GetProperty("payload").GetProperty("protocol_version").GetString() == "2.0.0" &&
            recording.Events.All(e => e.GetProperty("type").GetString() != "status" ||
                !e.TryGetProperty("payload", out var status) || status.GetProperty("phase").GetString() != "started") &&
            recording.Events.Any(e => e.TryGetProperty("code", out var code) && code.GetString() == "SIDECAR_START_FAILED" &&
                e.GetProperty("message").GetString()!.Contains("dictation recognizer", StringComparison.OrdinalIgnoreCase)),
            "Missing dictation is a structured start error before audio resolution");
        check(recording.Events.All(e => e.GetProperty("type").GetString() != "azure" &&
            (!e.TryGetProperty("code", out var code) || code.GetString() != "azure_incomplete")), "Missing SAPI has no Azure fallback");
    }

    // Opt-in integration check: feeds in-memory local TTS PCM through the live
    // stream adapter with two native engines. No WASAPI, microphone, speaker
    // playback, files, or service calls. Requires en-GB desktop TTS and STT.
    public static async Task RunSyntheticAsync(Action<bool, string> check)
    {
        async Task<string> RecognizeAsync(string phrase)
        {
            using var pcm = new MemoryStream();
            using (var voice = new SpeechSynthesizer())
            {
                voice.SelectVoiceByHints(VoiceGender.NotSet, VoiceAge.NotSet, 0, CultureInfo.GetCultureInfo("en-GB"));
                voice.SetOutputToAudioStream(pcm, WindowsSapi.SpeechPcm);
                voice.Speak(phrase);
                voice.SetOutputToNull();
            }
            using var recognizer = WindowsSapi.Open("en-GB");
            using var stream = new SapiPcmStream();
            var ready = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var completed = new TaskCompletionSource<RecognizeCompletedEventArgs>(TaskCreationOptions.RunContinuationsAsynchronously);
            var finals = new ConcurrentQueue<string>();
            recognizer.AudioStateChanged += (_, e) => { if (e.AudioState != AudioState.Stopped) ready.TrySetResult(); };
            recognizer.SpeechRecognized += (_, e) => finals.Enqueue(e.Result.Text);
            recognizer.RecognizeCompleted += (_, e) => { completed.TrySetResult(e); };
            recognizer.SetInputToAudioStream(stream, WindowsSapi.SpeechPcm);
            recognizer.RecognizeAsync(RecognizeMode.Multiple);
            try
            {
                var first = await Task.WhenAny(ready.Task, completed.Task).WaitAsync(TimeSpan.FromSeconds(5));
                if (first == completed.Task) throw new InvalidOperationException("Recognition ended before listening.", (await completed.Task).Error);
                await Task.Delay(250); // Intermittent playback stream is already listening.
                var bytes = pcm.ToArray();
                var playback = Stopwatch.StartNew();
                for (var offset = 0; offset < bytes.Length; offset += 640)
                {
                    if (!stream.TryPush(bytes[offset..Math.Min(bytes.Length, offset + 640)]))
                        throw new InvalidOperationException("Synthetic stream overran.");
                    var remaining = TimeSpan.FromSeconds((offset + 640) / 32000.0) - playback.Elapsed;
                    if (remaining > TimeSpan.Zero) await Task.Delay(remaining);
                }
                await Task.Delay(1200); // Silence is supplied by the stream, not the test fixture.
            }
            finally { stream.Finish(discard: false); }
            var done = await completed.Task.WaitAsync(TimeSpan.FromSeconds(5));
            if (done.Error is not null || done.Cancelled)
                throw new InvalidOperationException("Synthetic recognition did not finish gracefully.", done.Error);
            return string.Join(" ", finals);
        }

        var text = await Task.WhenAll(
            Task.Run(() => RecognizeAsync("Elephants drink water. Elephants drink water.")),
            Task.Run(() => RecognizeAsync("Penguins swim underwater. Penguins swim underwater.")));
        Console.WriteLine($"Synthetic SAPI PCM A: {text[0]} / B: {text[1]}");
        check(text[0].Contains("elephant", StringComparison.OrdinalIgnoreCase) && !text[0].Contains("penguin", StringComparison.OrdinalIgnoreCase),
            "First native engine recognizes only its own synthetic stream");
        check(text[1].Contains("penguin", StringComparison.OrdinalIgnoreCase) && !text[1].Contains("elephant", StringComparison.OrdinalIgnoreCase),
            "Second native engine recognizes only its own synthetic stream");
    }
}
