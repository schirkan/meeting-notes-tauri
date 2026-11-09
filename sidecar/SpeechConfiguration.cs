using Microsoft.CognitiveServices.Speech;

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

public static class SpeechConfiguration
{
    public static string? GetSpeechKey(IReadOnlyDictionary<string, string?> args)
    {
        var key = Environment.GetEnvironmentVariable("MEETING_NOTES_SPEECH_KEY");
        return string.IsNullOrWhiteSpace(key) ? args.GetValueOrDefault("--speech-key") : key;
    }

    public static SpeechConfig Create(AzureSpeechConfig config, string language, bool diarizeIntermediateResults = true)
    {
        var speech = SpeechConfig.FromEndpoint(new Uri(config.Endpoint), config.SpeechKey);
        speech.SpeechRecognitionLanguage = language;
        speech.SetProperty(PropertyId.SpeechServiceResponse_DiarizeIntermediateResults,
            diarizeIntermediateResults ? "true" : "false");
        speech.SetProperty("SpeechServiceResponse_InterimResults", config.InterimResults ? "true" : "false");
        speech.SetProperty(PropertyId.SpeechServiceConnection_LanguageIdMode, "Continuous");
        if (config.Proxy is { } proxy)
            speech.SetProxy(proxy.Host, proxy.Port, proxy.Username ?? string.Empty, proxy.Password ?? string.Empty);
        return speech;
    }

    public static string[] LidCandidates(string language) =>
        new[] { language, "de-DE", "en-US", "fr-FR", "es-ES", "it-IT", "pt-BR", "nl-NL", "pl-PL", "tr-TR", "ja-JP" }
            .Where(s => !string.IsNullOrWhiteSpace(s)).Distinct().ToArray();
}
