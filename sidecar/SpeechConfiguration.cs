using Microsoft.CognitiveServices.Speech;
using Microsoft.CognitiveServices.Speech.Audio;

namespace MeetingNotes.Sidecar;

public static class ProxyOptions
{
    public static AzureProxyConfig? Parse(IReadOnlyDictionary<string, string?> args)
    {
        var host = args.GetValueOrDefault("--proxy-host");
        var portRaw = args.GetValueOrDefault("--proxy-port");
        var username = Environment.GetEnvironmentVariable("MEETING_NOTES_PROXY_USERNAME")
                       ?? args.GetValueOrDefault("--proxy-username");
        var password = Environment.GetEnvironmentVariable("MEETING_NOTES_PROXY_PASSWORD")
                       ?? args.GetValueOrDefault("--proxy-password");
        if (string.IsNullOrWhiteSpace(host))
        {
            if (!string.IsNullOrWhiteSpace(portRaw) || !string.IsNullOrEmpty(username) || !string.IsNullOrEmpty(password))
                throw new ArgumentException("Proxy host is required when proxy port or credentials are provided.");
            return null;
        }
        host = host.Trim();
        if (Uri.CheckHostName(host) == UriHostNameType.Unknown || host == "true")
            throw new ArgumentException("Proxy host must be a hostname or IP address, not a URL.");
        if (!int.TryParse(portRaw, out var port) || port is < 1 or > 65535)
            throw new ArgumentException("Proxy port must be between 1 and 65535.");
        return new AzureProxyConfig(host, port, username, password);
    }
}

public enum AzureSpeechModel
{
    Standard,
    MaiTranscribe2Streaming
}

public static class SpeechConfiguration
{
    private const string MaiModel = "mai-transcribe-2-streaming";

    public static AzureSpeechModel ParseModel(string? model) => model switch
    {
        null or "standard" => AzureSpeechModel.Standard,
        MaiModel => AzureSpeechModel.MaiTranscribe2Streaming,
        _ => throw new ArgumentException("Select a supported transcription model: standard or mai-transcribe-2-streaming.")
    };

    public static string? GetSpeechKey(IReadOnlyDictionary<string, string?> args)
    {
        var key = Environment.GetEnvironmentVariable("MEETING_NOTES_SPEECH_KEY");
        return string.IsNullOrWhiteSpace(key) ? args.GetValueOrDefault("--speech-key") : key;
    }

    public static SpeechConfig Create(AzureSpeechConfig config, string language, bool diarizeIntermediateResults = true, bool stereo = false)
    {
        var speech = config.Model switch
        {
            AzureSpeechModel.Standard => SpeechConfig.FromEndpoint(new Uri(config.Endpoint), config.SpeechKey),
            AzureSpeechModel.MaiTranscribe2Streaming => SpeechConfig.FromSubscription(config.SpeechKey, config.Region),
            _ => throw new ArgumentOutOfRangeException(nameof(config.Model))
        };
        if (config.Model == AzureSpeechModel.MaiTranscribe2Streaming)
        {
            speech.Model = MaiModel;
        }
        else
        {
            speech.SpeechRecognitionLanguage = language;
            speech.SetProperty(PropertyId.SpeechServiceResponse_DiarizeIntermediateResults,
                diarizeIntermediateResults ? "true" : "false");
            if (!stereo) speech.SetProperty(PropertyId.SpeechServiceConnection_LanguageIdMode, "Continuous");
        }
        if (stereo) speech.SetProperty(PropertyId.Speech_EnableMultiChannelProcessing, "true");
        speech.SetProperty("SpeechServiceResponse_InterimResults", config.InterimResults && !stereo ? "true" : "false");
        if (config.Proxy is { } proxy)
            speech.SetProxy(proxy.Host, proxy.Port, proxy.Username ?? string.Empty, proxy.Password ?? string.Empty);
        return speech;
    }

    public static SpeechRecognizer CreateRecognizer(SpeechConfig speech, AudioConfig audio, AutoDetectSourceLanguageConfig? lid) =>
        lid is null ? new SpeechRecognizer(speech, audio) : new SpeechRecognizer(speech, lid, audio);

    public static AutoDetectSourceLanguageConfig? CreateLanguageDetection(AzureSpeechModel model, string language) =>
        model == AzureSpeechModel.Standard ? AutoDetectSourceLanguageConfig.FromLanguages(LidCandidates(language.Trim())) : null;

    public static string[] LidCandidates(string language) =>
        new[] { language, "de-DE", "en-US", "fr-FR", "es-ES", "it-IT", "pt-BR", "nl-NL", "pl-PL", "tr-TR", "ja-JP" }
            .Where(s => !string.IsNullOrWhiteSpace(s)).Distinct().ToArray();
}
