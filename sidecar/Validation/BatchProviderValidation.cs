using System.Diagnostics;
using System.Globalization;
using System.Speech.Synthesis;
using System.Text.Json;
using MeetingNotes.Sidecar;
using NAudio.Wave;

internal static class BatchProviderValidation
{
    public static async Task RunAsync(string exe, Action<ProcessStartInfo> configure, Action<bool, string> check, bool synthetic)
    {
        using var normal = JsonDocument.Parse(BatchTranscription.AzureDefinition(AzureSpeechModel.Standard, "en-GB", false, false));
        check(normal.RootElement.GetProperty("locales")[0].GetString() == "en-GB" &&
              !normal.RootElement.TryGetProperty("enhancedMode", out _), "Standard Fast Transcription uses the requested locale and no MAI options");
        using var mai = JsonDocument.Parse(BatchTranscription.AzureDefinition(AzureSpeechModel.MaiTranscribe2Streaming, "de-DE", false, true));
        check(mai.RootElement.GetProperty("enhancedMode").GetProperty("model").GetString() == "MAI-Transcribe-2" &&
              mai.RootElement.GetProperty("locales")[0].GetString() == "de" &&
              mai.RootElement.GetProperty("diarization").GetProperty("enabled").GetBoolean(), "MAI Fast Transcription selects the enhanced model and enables requested diarization");

        var directory = Directory.CreateTempSubdirectory();
        try
        {
            var file = Path.Combine(directory.FullName, "sample.wav");
            WriteSilence(file);
            var unsupported = await Run("--transcribe-batch", file, "--recognition-provider", "web-speech");
            check(unsupported.Exit != 0 && HasError(unsupported.Text, "BATCH_TRANSCRIPTION_FAILED", "Select a batch provider"),
                "Packaged dispatch rejects Web Speech file import");
            var removed = await Run("--transcribe-batch", file, "--recognition-provider", "windows-ai-speech");
            check(removed.Exit != 0 && HasError(removed.Text, "BATCH_TRANSCRIPTION_FAILED", "Select a batch provider"),
                "Packaged dispatch rejects the removed provider without falling back to Azure");
            var untrusted = await Run("--transcribe-batch", file, "--recognition-provider", "azure", "--speech-endpoint", "https://non-azure.invalid");
            check(untrusted.Exit != 0 && HasError(untrusted.Text, "BATCH_TRANSCRIPTION_FAILED", "HTTPS Azure Speech resource endpoint"),
                "Packaged Azure dispatch rejects untrusted upload destinations");
            var resource = await Run("--transcribe-batch", file, "--recognition-provider", "azure", "--speech-endpoint", "https://test.cognitiveservices.azure.com");
            check(resource.Exit != 0 && HasError(resource.Text, "BATCH_TRANSCRIPTION_FAILED", "subscription key"),
                "Packaged Azure dispatch requires a key before network access");
            var record = await Run("--record-batch", Path.Combine(directory.FullName, "no capture"), "--transcription-mic", "false", "--transcription-speaker", "false");
            check(record.Exit != 0 && HasError(record.Text, "SIDECAR_START_FAILED", "at least one audio source"),
                "Packaged batch capture dispatch validates sources without touching audio devices");
            if (!synthetic) return;

            // Synthesize directly to disk; never play to a speaker or open a capture device.
            var speech = Path.Combine(directory.FullName, "synthetic test speech.wav");
            using (var voice = new SpeechSynthesizer())
            {
                voice.SelectVoiceByHints(VoiceGender.NotSet, VoiceAge.NotSet, 0, CultureInfo.GetCultureInfo("en-GB"));
                voice.SetOutputToWaveFile(speech, WindowsSapi.SpeechPcm);
                voice.Speak("Elephants drink water. Elephants drink water.");
                voice.SetOutputToNull();
            }
            var sapi = await Run("--transcribe-batch", speech, "--recognition-provider", "windows-sapi", "--language", "en-GB");
            check(sapi.Exit == 0, $"Packaged native SAPI WAV job completed: {sapi.Text}");
            check(ReadEvents(sapi.Text).Any(e => e.GetProperty("type").GetString() == "batch_transcript" &&
                e.GetProperty("payload").GetProperty("segments").EnumerateArray().Any(s =>
                    (s.GetProperty("text").GetString() ?? "").Contains("elephant", StringComparison.OrdinalIgnoreCase) &&
                    s.GetProperty("offsetMs").ValueKind == JsonValueKind.Number)), "Packaged SAPI recognized synthesized speech with an offset");
        }
        finally { directory.Delete(recursive: true); }

        async Task<(int Exit, string Text)> Run(params string[] args)
        {
            var start = new ProcessStartInfo(exe)
            {
                UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
            };
            configure(start);
            foreach (var arg in args) start.ArgumentList.Add(arg);
            using var process = Process.Start(start) ?? throw new InvalidOperationException("Cannot start sidecar.");
            var output = process.StandardOutput.ReadToEndAsync();
            var errors = process.StandardError.ReadToEndAsync();
            try
            {
                await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(25));
                var text = await output;
                var stderr = await errors;
                if (stderr.Length != 0) throw new InvalidOperationException(stderr);
                return (process.ExitCode, text);
            }
            finally { if (!process.HasExited) process.Kill(true); }
        }
    }

    private static void WriteSilence(string path)
    {
        using var writer = new WaveFileWriter(path, new WaveFormat(16000, 16, 1));
        writer.Write(new byte[32000], 0, 32000);
    }

    private static IEnumerable<JsonElement> ReadEvents(string text)
    {
        foreach (var line in text.Split('\n', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        {
            using var doc = JsonDocument.Parse(line);
            yield return doc.RootElement.Clone();
        }
    }

    private static bool HasError(string text, string code, string message) => ReadEvents(text).Any(e =>
        e.TryGetProperty("code", out var value) && value.GetString() == code &&
        (e.GetProperty("message").GetString() ?? "").Contains(message, StringComparison.OrdinalIgnoreCase));
}
