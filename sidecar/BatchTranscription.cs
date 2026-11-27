using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Speech.Recognition;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace MeetingNotes.Sidecar;

internal static class BatchTranscription
{
    // The versioned REST reference lists the conservative limits for the inline audio part.
    private const long AzureFileSizeLimit = 250_000_000;
    private const int AzureDurationLimitSeconds = 2 * 60 * 60;
    private const string FastApiPath = "/speechtotext/transcriptions:transcribe?api-version=2025-10-15";

    internal sealed record Segment(string text, long? offsetMs, string? speaker, string? language);
    internal readonly record struct WaveInfo(long FileBytes, uint DataBytes, uint BytesPerSecond);
    private sealed class BatchFailure(string detail) : Exception(detail);

    internal static async Task<int> RunAsync(IReadOnlyDictionary<string, string?> args)
    {
        string provider = args.GetValueOrDefault("--recognition-provider") ?? "azure";
        try
        {
            if (provider is not ("azure" or "windows-sapi"))
                throw new BatchFailure("Select a batch provider: Azure or Windows SAPI.");
            var path = args.GetValueOrDefault("--transcribe-batch");
            if (string.IsNullOrWhiteSpace(path) || path == "true")
                throw new BatchFailure("Choose a WAV file for batch transcription.");
            path = Path.GetFullPath(path);
            var language = args.GetValueOrDefault("--language");
            if (string.IsNullOrWhiteSpace(language)) language = null;
            else if (!Regex.IsMatch(language, @"\A[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,4}\z"))
                throw new BatchFailure("Provide a valid speech language code, such as en-US.");

            // Keep the validated file open, preventing writes or replacement during recognition.
            using var audio = File.OpenRead(path);
            var wave = ReadWave(audio);
            var segments = provider == "azure"
                ? await RunAzureAsync(args, audio, wave, language)
                : await RunSapiAsync(path, language ?? "de-DE");
            Logger.Event("batch_transcript", new { segments });
            return 0;
        }
        catch (Exception ex)
        {
            // Don't echo exception messages from HTTP, native APIs or file I/O: they can
            // contain credentials, paths, provider response text or transcript content.
            var detail = ex switch
            {
                BatchFailure => ex.Message,
                EndOfStreamException => "The WAV file is incomplete.",
                FileNotFoundException or DirectoryNotFoundException or UnauthorizedAccessException => "The WAV file could not be opened.",
                OperationCanceledException => "Batch transcription timed out or was canceled.",
                HttpRequestException => "Azure Fast Transcription could not be reached. Check proxy and TLS settings.",
                JsonException => "Azure Fast Transcription returned an invalid response.",
                _ => provider switch
                {
                    "windows-sapi" => "Windows SAPI could not transcribe the WAV file.",
                    _ => "Azure Fast Transcription could not process the WAV file."
                }
            };
            Logger.Error("BATCH_TRANSCRIPTION_FAILED", detail);
            return 1;
        }
    }

    internal static Uri AzureUri(string? endpoint, AzureSpeechModel model)
    {
        // This endpoint is a saved Azure origin, not a URL derived from the file or region.
        // Match the raw input so URI canonicalization cannot hide userinfo, paths, or a port.
        const string label = @"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
        var suffix = model == AzureSpeechModel.Standard
            ? @"(?:cognitiveservices\.azure\.com|api\.cognitive\.microsoft\.com)"
            : @"cognitiveservices\.azure\.com";
        if (endpoint is null || !endpoint.All(char.IsAscii) || !Regex.IsMatch(endpoint, $@"\Ahttps://{label}\.{suffix}/?\z", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))
            throw new BatchFailure("Configure an HTTPS Azure Speech resource endpoint with no path, credentials, query, or port.");
        return new Uri(new Uri(endpoint, UriKind.Absolute), FastApiPath);
    }

    private static bool Flag(IReadOnlyDictionary<string, string?> args, string name)
    {
        if (!args.TryGetValue(name, out var value)) return false;
        if (bool.TryParse(value, out var result)) return result;
        throw new BatchFailure($"{name} must be true or false.");
    }

    internal static string AzureDefinition(AzureSpeechModel model, string? language, bool autoLanguage, bool diarization)
    {
        var mai = model == AzureSpeechModel.MaiTranscribe2Streaming;
        var definition = new JsonObject();
        if (!autoLanguage && language is not null)
        {
            // MAI takes a base language code (de), not the regional locale (de-DE).
            var locale = mai ? language.Split('-')[0].ToLowerInvariant() : language;
            definition["locales"] = new JsonArray(locale);
        }
        if (diarization) definition["diarization"] = new JsonObject { ["enabled"] = true };
        if (mai)
            definition["enhancedMode"] = new JsonObject
            {
                ["enabled"] = true,
                ["model"] = "MAI-Transcribe-2",
                ["modelOptions"] = new JsonObject { ["timestamps"] = "segment" }
            };
        return definition.ToJsonString();
    }

    private static async Task<Segment[]> RunAzureAsync(IReadOnlyDictionary<string, string?> args, Stream audio, WaveInfo wave, string? language)
    {
        AzureSpeechModel model;
        AzureProxyConfig? proxy;
        try { model = SpeechConfiguration.ParseModel(args.GetValueOrDefault("--speech-model")); }
        catch (ArgumentException) { throw new BatchFailure("Select a supported Azure transcription model."); }
        try { proxy = ProxyOptions.Parse(args); }
        catch (ArgumentException) { throw new BatchFailure("Invalid proxy configuration: provide a hostname or IP address and port 1-65535."); }
        var uri = AzureUri(args.GetValueOrDefault("--speech-endpoint"), model);
        var key = Environment.GetEnvironmentVariable("MEETING_NOTES_SPEECH_KEY");
        if (string.IsNullOrWhiteSpace(key)) throw new BatchFailure("Configure the Azure Speech subscription key.");
        if (wave.FileBytes >= AzureFileSizeLimit || wave.DataBytes >= (long)wave.BytesPerSecond * AzureDurationLimitSeconds)
            throw new BatchFailure("Azure Fast Transcription requires a WAV smaller than 250 MB and shorter than two hours. Split large recordings before retrying.");

        var definition = AzureDefinition(model, language, Flag(args, "--auto-language-detection"), Flag(args, "--diarization-speaker"));
        // Never forward the key (or resend the recording) to a redirect destination.
        // Match the existing native Speech SDK: direct transport unless a proxy was configured.
        using var handler = new HttpClientHandler { AllowAutoRedirect = false, UseProxy = proxy is not null };
        if (proxy is not null)
        {
            handler.Proxy = new WebProxy(new UriBuilder("http", proxy.Host, proxy.Port).Uri);
            if (!string.IsNullOrEmpty(proxy.Username) || !string.IsNullOrEmpty(proxy.Password))
                handler.Proxy.Credentials = new NetworkCredential(proxy.Username, proxy.Password);
        }
        using var client = new HttpClient(handler) { Timeout = TimeSpan.FromMinutes(15) };
        return await PostAzureAsync(client, uri, audio, definition, key);
    }

    internal static async Task<Segment[]> PostAzureAsync(HttpClient client, Uri uri, Stream audio, string definition, string key)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, uri);
        request.Headers.Add("Ocp-Apim-Subscription-Key", key);
        var form = new MultipartFormDataContent();
        request.Content = form;
        var wavePart = new StreamContent(audio);
        wavePart.Headers.ContentType = new MediaTypeHeaderValue("audio/wav");
        form.Add(wavePart, "audio", "recording.wav");
        form.Add(new StringContent(definition, Encoding.UTF8, "application/json"), "definition");
        using var response = await client.SendAsync(request);
        if (!response.IsSuccessStatusCode)
        {
            var status = (int)response.StatusCode;
            var hint = status switch
            {
                >= 300 and < 400 => " Redirects are not allowed.",
                401 or 403 => " Check the Azure resource, key and access permissions.",
                404 => " Check the Azure resource endpoint and model availability.",
                413 => " Split the recording and try again.",
                408 or 504 => " Try a shorter recording, especially when using diarization.",
                429 => " Wait before retrying.",
                _ => " Check regional model availability and supported recording limits."
            };
            throw new BatchFailure($"Azure Fast Transcription failed (HTTP {status}).{hint}");
        }
        await using var body = await response.Content.ReadAsStreamAsync();
        using var json = await JsonDocument.ParseAsync(body);
        return AzureSegments(json.RootElement);
    }

    internal static Segment[] AzureSegments(JsonElement result)
    {
        if (result.ValueKind != JsonValueKind.Object || !result.TryGetProperty("phrases", out var phrases) || phrases.ValueKind != JsonValueKind.Array)
            throw new BatchFailure("Azure Fast Transcription returned no phrase list.");
        var segments = new List<Segment>();
        foreach (var phrase in phrases.EnumerateArray())
        {
            if (phrase.ValueKind != JsonValueKind.Object)
                throw new BatchFailure("Azure Fast Transcription returned an invalid phrase.");
            var text = StringField(phrase, "text");
            if (string.IsNullOrWhiteSpace(text)) continue;
            long? offset = IntField(phrase, "offsetMilliseconds");
            var speaker = IntField(phrase, "speaker")?.ToString(CultureInfo.InvariantCulture);
            segments.Add(new Segment(text, offset, speaker, StringField(phrase, "locale")));
        }
        return segments.ToArray();
    }

    private static string? StringField(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static long? IntField(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var i) && i >= 0 ? i : null;

    private static async Task<Segment[]> RunSapiAsync(string path, string language)
    {
        SpeechRecognitionEngine engine;
        try { engine = WindowsSapi.Open(language); }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException)
        {
            throw new BatchFailure($"Windows SAPI could not load a desktop dictation recognizer for {language}.");
        }
        using (engine)
        {
            engine.SetInputToWaveFile(path);
            var completion = new TaskCompletionSource<Segment[]>(TaskCreationOptions.RunContinuationsAsynchronously);
            var segments = new List<Segment>();
            engine.SpeechRecognized += (_, e) =>
            {
                if (e.Result is { } result && !string.IsNullOrWhiteSpace(result.Text))
                    segments.Add(new Segment(result.Text, (long?)result.Audio?.AudioPosition.TotalMilliseconds, null, language));
            };
            engine.RecognizeCompleted += (_, e) =>
            {
                if (e.Error is not null) completion.TrySetException(e.Error);
                else if (e.Cancelled) completion.TrySetCanceled();
                else completion.TrySetResult(segments.ToArray());
            };
            engine.RecognizeAsync(RecognizeMode.Multiple);
            return await completion.Task;
        }
    }

    // RIFF/WAVE with one fmt chunk and one non-empty data chunk. Accept mono/stereo
    // packed integer PCM (8/16/24/32-bit), including PCM WAVEFORMATEXTENSIBLE.
    // Unknown metadata chunks are skipped; RF64, float and compressed WAV are not accepted.
    internal static WaveInfo ReadWave(Stream audio)
    {
        static BatchFailure InvalidWave() => new("Choose a valid mono or stereo integer PCM WAV file with audio data.");
        using var reader = new BinaryReader(audio, Encoding.UTF8, leaveOpen: true);
        const uint Riff = 0x46464952, Wave = 0x45564157, Fmt = 0x20746d66, Data = 0x61746164;
        if (reader.ReadUInt32() != Riff) throw InvalidWave();
        var end = 8L + reader.ReadUInt32();
        if (end != audio.Length || end < 12 || reader.ReadUInt32() != Wave) throw InvalidWave();
        uint bytesPerSecond = 0, dataBytes = 0;
        ushort frameBytes = 0;
        while (audio.Position < end)
        {
            if (end - audio.Position < 8) throw InvalidWave();
            var id = reader.ReadUInt32();
            var size = reader.ReadUInt32();
            var next = audio.Position + size + (size & 1);
            if (next > end) throw InvalidWave();
            if (id == Fmt)
            {
                if (bytesPerSecond != 0 || size < 16) throw InvalidWave();
                var format = reader.ReadUInt16();
                var channels = reader.ReadUInt16();
                var rate = reader.ReadUInt32();
                bytesPerSecond = reader.ReadUInt32();
                frameBytes = reader.ReadUInt16();
                var bits = reader.ReadUInt16();
                if (channels is not (1 or 2) || rate == 0 || bits is not (8 or 16 or 24 or 32)
                    || frameBytes != channels * bits / 8 || bytesPerSecond != (long)rate * frameBytes)
                    throw InvalidWave();
                if (format == 0xfffe)
                {
                    if (size < 40) throw InvalidWave();
                    var extra = reader.ReadUInt16();
                    var validBits = reader.ReadUInt16();
                    _ = reader.ReadUInt32(); // speaker mask; no channel separation requested
                    var subtype = new Guid(reader.ReadBytes(16));
                    if (extra < 22 || extra > size - 18 || validBits == 0 || validBits > bits || subtype != new Guid("00000001-0000-0010-8000-00aa00389b71"))
                        throw InvalidWave();
                }
                else if (format != 1) throw InvalidWave();
            }
            else if (id == Data)
            {
                if (frameBytes == 0 || dataBytes != 0 || size == 0 || size % frameBytes != 0) throw InvalidWave();
                dataBytes = size;
            }
            audio.Position = next;
        }
        if (dataBytes == 0) throw InvalidWave();
        audio.Position = 0;
        return new WaveInfo(end, dataBytes, bytesPerSecond);
    }
}
