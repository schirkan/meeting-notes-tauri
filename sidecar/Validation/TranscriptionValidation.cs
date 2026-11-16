using System.Text.Json;
using MeetingNotes.Sidecar;

/// <summary>
/// Validierung der Transkriptions-Quellen (T-511).
///
/// Die Transkription ist eine eigene Achse neben der Diarization: eine Quelle
/// kann ohne Sprechererkennung transkribiert werden. Geprueft werden die
/// CLI-Optionen, die JSON-Rundreise und die Quellenauswahl im Sidecar.
/// </summary>
internal static class TranscriptionValidation
{
    public static void Run(Action<bool, string> check)
    {
        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

        // CLI-Optionen: Default aktiv, explizites false bleibt erhalten.
        check(ArgsParser.ParseTranscription(ArgsParser.Parse([])) == new TranscriptionSettings(),
            "CLI defaults enable both transcription sources");
        check(ArgsParser.ParseTranscription(ArgsParser.Parse(["--transcription-mic", "false"]))
              == new TranscriptionSettings(false, true),
            "Missing speaker transcription option defaults true");
        check(ArgsParser.ParseTranscription(ArgsParser.Parse(["--transcription-speaker", "false", "--transcription-mic"]))
              == new TranscriptionSettings(true, false),
            "Bare mic switch and explicit speaker false");
        foreach (var invalid in new[] { "invalid", "0", "1", "" })
        {
            try
            {
                ArgsParser.ParseTranscription(ArgsParser.Parse(["--transcription-mic", invalid]));
                check(false, "Invalid transcription boolean accepted");
            }
            catch (ArgumentException) { check(true, "Invalid transcription boolean rejected"); }
        }

        // JSON-Rundreise: explizites false bleibt false, fehlende Felder sind true.
        foreach (var (json, mic, speaker) in new[]
        {
            ("", true, true),
            (",\"transcription\":{}", true, true),
            (",\"transcription\":{\"mic\":false}", false, true),
            (",\"transcription\":{\"speaker\":false}", true, false),
            (",\"transcription\":{\"mic\":false,\"speaker\":false}", false, false),
            (",\"transcription\":{\"mic\":true,\"speaker\":true}", true, true),
        })
        {
            var settings = JsonSerializer.Deserialize<UserSettings>(
                "{\"language\":\"de-DE\",\"devices\":{}" + json + "}", jsonOptions)!;
            check(settings.Transcription == new TranscriptionSettings(mic, speaker),
                "JSON defaults preserve explicit false");
            var roundtrip = JsonSerializer.Deserialize<UserSettings>(
                JsonSerializer.Serialize(settings, jsonOptions), jsonOptions)!;
            check(roundtrip.Transcription == settings.Transcription,
                "Settings roundtrip preserves transcription");
        }
        check(new UserSettings("de-DE", new DeviceIds(null, null)).Transcription == new TranscriptionSettings(),
            "C# defaults enable both transcription sources");

        // Quellenauswahl: nur transkribierte Quellen bekommen einen Recognizer.
        var config = new AzureSpeechConfig("wss://localhost/speech/universal/v2", "westeurope", "validation-key", true, null);
        foreach (var mic in new[] { true, false })
        foreach (var speaker in new[] { true, false })
        {
            var transcription = new TranscriptionSettings(mic, speaker);
            var settings = new UserSettings("de-DE", new DeviceIds(null, null)) { Transcription = transcription };
            using var service = new AzureSpeechService(config, settings);

            var expected = new List<string>();
            if (mic) expected.Add(AzureSpeechService.SourceMic);
            if (speaker) expected.Add(AzureSpeechService.SourceSpeaker);
            check(service.TranscriptionSources.SequenceEqual(expected),
                "Only transcribed sources receive a recognizer");

            // Die Sprechererkennung wirkt nur, wenn eine transkribierte Quelle sie nutzt.
            foreach (var diaMic in new[] { true, false })
            foreach (var diaSpeaker in new[] { true, false })
            {
                var withDiarization = new UserSettings("de-DE", new DeviceIds(null, null))
                {
                    Transcription = transcription,
                    Diarization = new DiarizationSettings(diaMic, diaSpeaker)
                };
                using var diarizedService = new AzureSpeechService(config, withDiarization);
                var effective = (mic && diaMic) || (speaker && diaSpeaker);
                check(diarizedService.EffectiveDiarization == effective,
                    "Intermediate diarization is effective only for transcribed sources");
            }
        }

        // Beide Quellen ausgeschaltet -> kein Recognizer, Start bricht ab.
        var none = new UserSettings("de-DE", new DeviceIds(null, null))
        {
            Transcription = new TranscriptionSettings(false, false)
        };
        using var noneService = new AzureSpeechService(config, none);
        check(noneService.TranscriptionSources.Count == 0,
            "No transcription source yields no recognizer");
    }
}
