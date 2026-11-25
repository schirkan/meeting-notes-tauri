using System.Collections.Generic;

namespace MeetingNotes.Sidecar;

/// <summary>
/// Parses sidecar CLI args into a dictionary. Supports both
/// <c>--key value</c> and bare <c>--flag</c> (treated as boolean true).
/// </summary>
public static class ArgsParser
{
    public static DiarizationSettings ParseDiarization(IReadOnlyDictionary<string, string?> args)
    {
        bool Enabled(string key)
        {
            if (!args.TryGetValue(key, out var raw)) return true;
            if (bool.TryParse(raw, out var enabled)) return enabled;
            throw new System.ArgumentException($"{key} must be true or false.");
        }
        return new DiarizationSettings(Enabled("--diarization-mic"), Enabled("--diarization-speaker"));
    }

    public static TranscriptionSettings ParseTranscription(IReadOnlyDictionary<string, string?> args)
    {
        bool Enabled(string key)
        {
            if (!args.TryGetValue(key, out var raw)) return true;
            if (bool.TryParse(raw, out var enabled)) return enabled;
            throw new ArgumentException($"{key} must be true or false.");
        }
        return new TranscriptionSettings(Enabled("--transcription-mic"), Enabled("--transcription-speaker"));
    }

    public static bool ParseStereo(IReadOnlyDictionary<string, string?> args, TranscriptionSettings sources, AzureSpeechModel model) =>
        args.GetValueOrDefault("--audio-mode") switch
        {
            null or "dual-mono" => false,
            "stereo" when sources.Mic && sources.Speaker && model == AzureSpeechModel.MaiTranscribe2Streaming =>
                throw new ArgumentException("Stereo is not supported with MAI Transcribe. Use dual mono."),
            "stereo" => sources.Mic && sources.Speaker,
            _ => throw new ArgumentException("--audio-mode must be dual-mono or stereo.")
        };

    public static bool ParseAutoLanguageDetection(IReadOnlyDictionary<string, string?> args) =>
        Enabled(args, "--auto-language-detection");

    public static bool ParseInterimResults(IReadOnlyDictionary<string, string?> args) =>
        Enabled(args, "--interim-results");

    private static bool Enabled(IReadOnlyDictionary<string, string?> args, string key)
    {
        if (!args.TryGetValue(key, out var raw)) return true;
        if (bool.TryParse(raw, out var enabled)) return enabled;
        throw new ArgumentException($"{key} must be true or false.");
    }

    public static Dictionary<string, string?> Parse(string[] args)
    {
        var result = new Dictionary<string, string?>(System.StringComparer.OrdinalIgnoreCase);

        for (var i = 0; i < args.Length; i++)
        {
            var key = args[i];
            if (!key.StartsWith("--", System.StringComparison.Ordinal)) continue;

            var hasValue = i + 1 < args.Length && !args[i + 1].StartsWith("--", System.StringComparison.Ordinal);
            result[key] = hasValue ? args[++i] : "true";
        }

        return result;
    }
}
