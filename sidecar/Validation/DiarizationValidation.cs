using System.Text.Json;
using Microsoft.CognitiveServices.Speech;
using MeetingNotes.Sidecar;

internal static class DiarizationValidation
{
    public static void Run(Action<bool, string> check)
    {
        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
        foreach (var (json, mic, speaker) in new[]
        {
            ("", true, true),
            (",\"diarization\":{}", true, true),
            (",\"diarization\":{\"mic\":false}", false, true),
            (",\"diarization\":{\"speaker\":false}", true, false),
            (",\"diarization\":{\"mic\":false,\"speaker\":false}", false, false)
        })
        {
            var settings = JsonSerializer.Deserialize<UserSettings>("{\"language\":\"de-DE\",\"devices\":{}" + json + "}", jsonOptions)!;
            check(settings.Diarization == new DiarizationSettings(mic, speaker), "JSON defaults preserve explicit false");
            var roundtrip = JsonSerializer.Deserialize<UserSettings>(JsonSerializer.Serialize(settings, jsonOptions), jsonOptions)!;
            check(roundtrip.Diarization == settings.Diarization, "Settings roundtrip preserves diarization");
        }
        check(new UserSettings("de-DE", new DeviceIds(null, null)).Diarization == new DiarizationSettings(), "C# defaults enable both sources");
        check(ArgsParser.ParseDiarization(ArgsParser.Parse([])) == new DiarizationSettings(), "CLI defaults enable both sources");
        check(ArgsParser.ParseDiarization(ArgsParser.Parse(["--diarization-mic", "false"])) == new DiarizationSettings(false, true), "Missing speaker CLI option defaults true");
        check(ArgsParser.ParseDiarization(ArgsParser.Parse(["--diarization-speaker", "false", "--diarization-mic"])) == new DiarizationSettings(true, false), "Bare mic switch and explicit speaker false");
        foreach (var invalid in new[] { "invalid", "0", "1", "" })
        {
            try
            {
                ArgsParser.ParseDiarization(ArgsParser.Parse(["--diarization-mic", invalid]));
                check(false, "Invalid diarization boolean accepted");
            }
            catch (ArgumentException) { check(true, "Invalid diarization boolean rejected"); }
        }

        (string[] Args, bool[] Expected)[] monoCases =
        [
            ([], [true]),
            (["--diarization-mic", "false", "--diarization-speaker", "false"], [false]),
            (["--diarization-mic", "false"], [false, true]),
            (["--diarization-speaker", "false"], [false, true]),
            (["--transcription-speaker", "false", "--diarization-speaker", "false"], [true]),
            (["--transcription-speaker", "false", "--diarization-mic", "false"], [false]),
            (["--transcription-mic", "false", "--diarization-mic", "false"], [true]),
            (["--transcription-mic", "false", "--diarization-speaker", "false"], [false]),
            (["--transcription-mic", "false", "--transcription-speaker", "false"], [])
        ];
        foreach (var (cli, expected) in monoCases)
        {
            var args = ArgsParser.Parse(cli);
            var probes = SpeechConnectivityDiagnostic.SelectStandardMonoProbes(
                ArgsParser.ParseTranscription(args), ArgsParser.ParseDiarization(args));
            check(probes.SequenceEqual(expected), $"Standard mono selects one probe per active recognizer type: {string.Join(" ", cli.DefaultIfEmpty("(defaults)"))}");
        }

        // T-507: Die stdin-Kommandoschale des Sidecars.
        check(SidecarCommands.ReadType("{\"type\":\"pause\"}") == "pause", "Pause command parsed");
        check(SidecarCommands.ReadType("{\"type\":\"resume\"}") == "resume", "Resume command parsed");
        check(SidecarCommands.ReadType("{\"type\":\"shutdown\"}") == "shutdown", "Shutdown command parsed");
        check(SidecarCommands.ReadType("{\"type\":\"reset\"}") == "reset", "Reset command parsed");
        check(SidecarCommands.ReadType("{\"type\":\"PAUSE\"}") == "pause", "Command type is case insensitive");
        check(SidecarCommands.ReadType("not json") == SidecarCommands.Unknown, "Invalid JSON is rejected");
        check(SidecarCommands.ReadType("{}") == SidecarCommands.Unknown, "Missing type is rejected");
        check(SidecarCommands.ReadType("") == SidecarCommands.Unknown, "Empty line is rejected");

        var config = new AzureSpeechConfig("wss://localhost/speech/universal/v2", "westeurope", "validation-key", true, null);
        var disabled = ArgsParser.Parse(["--auto-language-detection", "false", "--interim-results", "false"]);
        var fixedSpeech = SpeechConfiguration.Create(config with { InterimResults = ArgsParser.ParseInterimResults(disabled) },
            "fr-FR", autoLanguageDetection: ArgsParser.ParseAutoLanguageDetection(disabled));
        check(fixedSpeech.SpeechRecognitionLanguage == "fr-FR" &&
            fixedSpeech.GetProperty(PropertyId.SpeechServiceConnection_LanguageIdMode) != "Continuous" &&
            SpeechConfiguration.CreateLanguageDetection(config.Model, "fr-FR", ArgsParser.ParseAutoLanguageDetection(disabled)) is null,
            "Disabling language detection uses only the primary language");
        check(fixedSpeech.GetProperty("SpeechServiceResponse_InterimResults") == "false" &&
            fixedSpeech.GetProperty(PropertyId.SpeechServiceResponse_DiarizeIntermediateResults) == "false",
            "Disabling interim results also disables intermediate diarization");
        var mai = config with
        {
            Endpoint = "not a URL",
            Region = "swedencentral",
            Model = SpeechConfiguration.ParseModel("mai-transcribe-2-streaming")
        };
        var stereoSpeech = SpeechConfiguration.Create(config, "de-DE", stereo: true);
        check(stereoSpeech.GetProperty("SpeechServiceResponse_InterimResults") == "true" &&
            stereoSpeech.GetProperty(PropertyId.SpeechServiceResponse_DiarizeIntermediateResults) == "true",
            "Stereo can request interim results and interim speaker IDs");
        foreach (var enabled in new[] { false, true })
        using (var service = new AzureSpeechService(mai, new UserSettings("de-DE", new DeviceIds(null, null))
            { Diarization = new DiarizationSettings(enabled, enabled) }))
        {
            var maiSpeech = SpeechConfiguration.Create(mai, "de-DE", diarizeIntermediateResults: enabled);
            check(maiSpeech.Model == "mai-transcribe-2-streaming" &&
                SpeechConfiguration.CreateLanguageDetection(mai.Model, "de-DE") is null &&
                maiSpeech.GetProperty(PropertyId.SpeechServiceResponse_DiarizeIntermediateResults) == "false" &&
                !service.EffectiveDiarization &&
                service.GetRecognitionMode(AzureSpeechService.SourceMic) == "speechRecognizer" &&
                service.GetRecognitionMode(AzureSpeechService.SourceSpeaker) == "speechRecognizer",
                "MAI uses the speech recognizer without diarization regardless of speaker settings");
        }
        var stereoArgs = ArgsParser.Parse(["--audio-mode", "stereo"]);
        try
        {
            ArgsParser.ParseStereo(stereoArgs, new TranscriptionSettings(true, true), mai.Model);
            check(false, "MAI must reject stereo on the standalone CLI");
        }
        catch (ArgumentException) { check(true, "MAI rejects stereo on the standalone CLI"); }
        foreach (var mic in new[] { true, false })
        foreach (var speaker in new[] { true, false })
        {
            var options = ArgsParser.ParseDiarization(ArgsParser.Parse([
                "--diarization-mic", mic.ToString().ToLowerInvariant(),
                "--diarization-speaker", speaker.ToString().ToLowerInvariant()]));
            var settings = new UserSettings("de-DE", new DeviceIds(null, null)) { Diarization = options };
            using var service = new AzureSpeechService(config, settings);
            var speechConfig = SpeechConfiguration.Create(config, settings.Language, mic || speaker);
            check(speechConfig.GetProperty(PropertyId.SpeechServiceResponse_DiarizeIntermediateResults) == (mic || speaker ? "true" : "false"), "Installed SDK supports native intermediate diarization property");
            foreach (var source in new[] { AzureSpeechService.SourceMic, AzureSpeechService.SourceSpeaker })
            {
                var enabled = options.IsEnabled(source);
                check(service.GetRecognitionMode(source) == (enabled ? "conversationTranscriber" : "speechRecognizer"), "Independent recognizer selection");
                var originalOut = Console.Out;
                using var output = new StringWriter();
                try
                {
                    Console.SetOut(output);
                    foreach (var state in new[] { "interim", "final" })
                    foreach (var id in new string?[] { "Guest-1", " raw-sdk-id ", "Unknown", null, "", " " })
                        service.EmitTranscript(source, "validation text", state, 0.9, id, "de-DE");
                }
                finally { Console.SetOut(originalOut); }
                var events = output.ToString().Split('\n', StringSplitOptions.RemoveEmptyEntries)
                    .Select(line => JsonDocument.Parse(line)).ToArray();
                try
                {
                    check(events.Count(e => e.RootElement.TryGetProperty("code", out var code) && code.GetString() == "missing_speaker") == (enabled ? 1 : 0), "Warnings occur once only for diarized sources");
                    var transcripts = events.Where(e => e.RootElement.GetProperty("type").GetString() == "transcript").ToArray();
                    check(transcripts.Length == 12, "Both interim and final events emitted");
                    for (var i = 0; i < transcripts.Length; i++)
                    {
                        var payload = transcripts[i].RootElement.GetProperty("payload");
                        var expected = enabled
                            ? new[] { "Guest-1", " raw-sdk-id ", "Unknown", "unknown", "unknown", "unknown" }[i % 6]
                            : source == AzureSpeechService.SourceMic ? "self" : "guest";
                        check(payload.GetProperty("source").GetString() == source, "Raw source preserved");
                        check(payload.GetProperty("speaker").GetString() == expected, "Raw SDK ID or fixed source speaker preserved, missing ID falls back to unknown");
                        check(payload.GetProperty("state").GetString() == (i < 6 ? "interim" : "final"), "Transcript state preserved");
                        // T-507: Jedes Segment traegt die Session-Dimension. Ohne sie
                        // kann das UI "Guest-1" aus zwei Sitzungen nicht trennen.
                        check(payload.TryGetProperty("sessionId", out var sessionId) && !string.IsNullOrWhiteSpace(sessionId.GetString()),
                            "Every segment carries a session id");
                    }
                }
                finally { foreach (var item in events) item.Dispose(); }
            }
        }
    }
}
