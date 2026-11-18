using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using MeetingNotes.Sidecar;

var sidecarArg = Array.IndexOf(args, "--sidecar-exe");
if (sidecarArg >= 0 && (sidecarArg + 1 >= args.Length || !File.Exists(args[sidecarArg + 1])))
    throw new ArgumentException("--sidecar-exe requires an existing published executable.");
var sidecar = sidecarArg >= 0
    ? Path.GetFullPath(args[sidecarArg + 1])
    : Path.Combine(AppContext.BaseDirectory, "MeetingNotes.Sidecar.exe");
var missingRuntimeRoot = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
var probeDeps = missingRuntimeRoot + ".deps.json";
void ProbeSelfContained(ProcessStartInfo start)
{
    if (sidecarArg < 0) return;
    start.Environment["DOTNET_ROOT"] = missingRuntimeRoot;
    start.Environment["DOTNET_ROOT_X64"] = missingRuntimeRoot;
    start.Environment["DOTNET_ROOT_ARM64"] = missingRuntimeRoot;
    start.Environment["DOTNET_MULTILEVEL_LOOKUP"] = "0";
    start.Environment["DOTNET_ADDITIONAL_DEPS"] = probeDeps;
}

var variables = new[] { "MEETING_NOTES_SPEECH_KEY", "MEETING_NOTES_PROXY_USERNAME", "MEETING_NOTES_PROXY_PASSWORD" };
var previous = variables.Select(Environment.GetEnvironmentVariable).ToArray();
var assertions = 0;
void Check(bool condition, string description)
{
    if (!condition) throw new InvalidOperationException(description);
    assertions++;
}
Dictionary<string, string?> Parse(params string[] args) => ArgsParser.Parse(args);
if (args.Contains("--loopback-hardware"))
{
    var start = new ProcessStartInfo(sidecar) { RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };
    foreach (var argument in new[] { "--transcription-mic", "false", "--transcription-speaker", "true", "--sample-rate", "16000" })
        start.ArgumentList.Add(argument);
    foreach (var variable in variables) start.Environment[variable] = "";
    using var process = Process.Start(start)!;
    var stdout = process.StandardOutput.ReadToEndAsync();
    var stderr = process.StandardError.ReadToEndAsync();
    try
    {
        await process.StandardInput.WriteLineAsync("{\"type\":\"handshake-ack\"}");
        await process.StandardInput.FlushAsync();
        await Task.Delay(TimeSpan.FromSeconds(5));
        await process.StandardInput.WriteLineAsync("{\"type\":\"shutdown\"}");
        await process.StandardInput.FlushAsync();
        await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(8));
        Check(process.ExitCode == 0, "Loopback hardware probe shuts down cleanly");
        Check(string.IsNullOrEmpty(await stderr), "Loopback hardware probe has no stderr failure");
        var events = (await stdout).Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .Select(line =>
            {
                using var document = JsonDocument.Parse(line);
                return document.RootElement.Clone();
            }).ToArray();
        bool HasCode(string code) => events.Any(e => e.TryGetProperty("code", out var value) && value.GetString() == code);
        Check(events[0].GetProperty("type").GetString() == "handshake", "Loopback probe receives initial handshake");
        Check(HasCode("handshake_ack"), "Published sidecar accepts handshake-ack");
        Check(!HasCode("unknown_command"), "Handshake acknowledgement is not an unknown command");
        Check(events.Any(e => e.GetProperty("type").GetString() == "status" && e.TryGetProperty("payload", out var payload) &&
            payload.GetProperty("phase").GetString() == "started" && payload.GetProperty("running").GetBoolean()),
            "Loopback recording starts on real hardware");
        Check(!HasCode("engine_format_mismatch") && !HasCode("engine_conversion_unavailable") &&
            events.All(e => e.GetProperty("type").GetString() != "error"),
            "Loopback stays in engine mode without false rate fallback or capture errors");
        Console.WriteLine($"PASS: {assertions} loopback hardware assertions (5 s; no microphone, Azure or audio files).");
    }
    finally
    {
        if (!process.HasExited) process.Kill(true);
    }
    return;
}
MeetingDetectionValidation.Run(Check);
DiarizationValidation.Run(Check);
TranscriptionValidation.Run(Check);
ResamplingValidation.Run(Check);
if (args.Contains("--diarization-only"))
{
    Console.WriteLine($"Diarization validation passed ({assertions} assertions).");
    return;
}
try
{
    foreach (var variable in variables) Environment.SetEnvironmentVariable(variable, null);
    if (sidecarArg >= 0)
    {
        File.WriteAllText(probeDeps, "{");
        foreach (var (arguments, expectedExit, expectedType) in new[]
        {
            (new[] { "--list-devices" }, 0, "device_list"),
            (new[] { "--transcription-mic", "false", "--transcription-speaker", "false" }, 23, "handshake"),
            (new[] { "--test-connectivity" }, 1, "speech_connectivity")
        })
        {
            var start = new ProcessStartInfo(sidecar) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };
            foreach (var argument in arguments) start.ArgumentList.Add(argument);
            ProbeSelfContained(start);
            using var process = Process.Start(start)!;
            var stdout = process.StandardOutput.ReadToEndAsync();
            var stderr = process.StandardError.ReadToEndAsync();
            try { await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(15)); }
            catch { process.Kill(true); throw; }
            Check(process.ExitCode == expectedExit, "Published sidecar exits correctly without installed runtime probing");
            Check(string.IsNullOrEmpty(await stderr), "Published sidecar has no stderr failure");
            var events = (await stdout).Split('\n', StringSplitOptions.RemoveEmptyEntries).Select(line => JsonDocument.Parse(line)).ToArray();
            try
            {
                Check(events[0].RootElement.GetProperty("type").GetString() == expectedType, "Trimmed sidecar preserves JSON event type");
                var payload = events[0].RootElement.GetProperty("payload");
                if (expectedType == "device_list")
                {
                    Check(payload.GetProperty("Inputs").ValueKind == JsonValueKind.Array && payload.GetProperty("Outputs").ValueKind == JsonValueKind.Array,
                        "Trimmed device-list retains both device collections");
                }
                else if (expectedType == "handshake")
                {
                    Check(payload.GetProperty("protocol_version").GetString() == "1.0.0" && payload.GetProperty("capabilities").GetArrayLength() == 5,
                        "Trimmed handshake retains version and capabilities");
                    Check(events[1].RootElement.GetProperty("code").GetString() == "SIDECAR_START_FAILED", "Trimmed sidecar preserves structured source error");
                }
                else
                {
                    Check(!payload.GetProperty("reachable").GetBoolean() && payload.GetProperty("steps")[0].GetProperty("step").GetString() == "speech_config",
                        "Trimmed diagnostic retains configuration failure payload");
                }
            }
            finally { foreach (var json in events) json.Dispose(); }
        }
    }
    // T-513: Erkennungsmodus. Der Sidecar beobachtet den Core-Audio-
    // Session-Graph. Der Test oeffnet in einem FREMDEN Prozess eine
    // Capture-Sitzung - der Detektor schliesst den eigenen Prozess aus,
    // ein zweiter Prozess muss deshalb als Meeting durchkommen.
    {
        var start = new ProcessStartInfo(sidecar)
        {
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        // Der Prozessname des Validierungslaufs wird erlaubt, damit die
        // eigene Capture-Sitzung als Meeting-Signal durchkommt.
        var ownProcessName = System.Diagnostics.Process.GetCurrentProcess().ProcessName;
        start.ArgumentList.Add("--detect-only");
        start.ArgumentList.Add("--meeting-processes");
        start.ArgumentList.Add(ownProcessName);
        foreach (var variable in variables) start.Environment[variable] = "";
        ProbeSelfContained(start);
        using var process = Process.Start(start)!;
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        try
        {
            await process.StandardInput.WriteLineAsync("{\"type\":\"handshake-ack\"}");
            await process.StandardInput.FlushAsync();
            // Warten, bis der Detektor bereit ist, dann eine Capture-Sitzung
            // im Validierungsprozess oeffnen (fremder Prozess fuer den Detektor).
            await Task.Delay(TimeSpan.FromSeconds(3));
            var detectorReady = false;
            var captured = false;
            using (var enumerator = new NAudio.CoreAudioApi.MMDeviceEnumerator())
            {
                var mic = enumerator.GetDefaultAudioEndpoint(NAudio.CoreAudioApi.DataFlow.Capture, NAudio.CoreAudioApi.Role.Multimedia);
                var recorder = new NAudio.Wave.WasapiRecorderBuilder()
                    .WithDevice(mic)
                    .WithSharedMode()
                    .WithEventSync()
                    .WithFormat(new NAudio.Wave.WaveFormat(8000, 16, 1))
                    .Build();
                recorder.StartRecording();
                captured = true;
                await Task.Delay(TimeSpan.FromSeconds(4));
                recorder.StopRecording();
                recorder.Dispose();
            }
            Check(captured, "Detection probe opened a capture session");
            await Task.Delay(TimeSpan.FromSeconds(5));
            await process.StandardInput.WriteLineAsync("{\"type\":\"shutdown\"}");
            await process.StandardInput.FlushAsync();
            try { await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(8)); }
            catch { process.Kill(true); }
            var detectorOutput = await stdout;
            var documents = detectorOutput.Split('\n', StringSplitOptions.RemoveEmptyEntries)
                .Select(line => JsonDocument.Parse(line))
                .ToArray();
            var events = documents.Select(d => d.RootElement.Clone()).ToArray();
            try
            {
                Check(events.Length > 0 && events[0].GetProperty("type").GetString() == "handshake",
                    "Detection mode sends the handshake first");
                var capabilities = events[0].GetProperty("payload").GetProperty("capabilities");
                Check(capabilities.EnumerateArray().Any(c => c.GetString() == "meeting_detection"),
                    "Detection mode announces the meeting_detection capability");
                var detection = events.FirstOrDefault(e =>
                    e.TryGetProperty("type", out var type) && type.GetString() == "meeting_detected");
                Check(detection.ValueKind == JsonValueKind.Object,
                    "Detection mode reports the foreign capture session as meeting_detected");
                var payload = detection.GetProperty("payload");
                Check(payload.GetProperty("process_name").GetString() == ownProcessName,
                    "Meeting detection resolves the process name from the session PID");
                Check(payload.GetProperty("signal").GetString() == "mic",
                    "Meeting detection reports the microphone signal");
                var ended = events.SingleOrDefault(e =>
                    e.TryGetProperty("type", out var type) && type.GetString() == "meeting_ended");
                Check(ended.ValueKind == JsonValueKind.Object, "Detection mode reports one debounced meeting_ended event");
                var endPayload = ended.GetProperty("payload");
                Check(endPayload.GetProperty("process_name").GetString() == ownProcessName &&
                    endPayload.GetProperty("process_id").GetUInt32() == (uint)Environment.ProcessId,
                    "End event retains exact process identity");
                Check(endPayload.GetProperty("signal").GetString() == "mic", "End event retains initiating signal");
                Check(Array.FindIndex(events, e => e.GetProperty("type").GetString() == "meeting_detected") <
                    Array.FindIndex(events, e => e.GetProperty("type").GetString() == "meeting_ended"),
                    "Detection precedes the corresponding end event");
                detectorReady = true;
            }
            finally { foreach (var document in documents) document.Dispose(); }
            Check(detectorReady, "Detection mode reported a meeting");
            Check(string.IsNullOrEmpty(await stderr), "Detection mode has no stderr failure");
        }
        catch
        {
            try { process.Kill(true); } catch { }
            throw;
        }
    }
    await MeetingDetectionValidation.RunExistingSessionAsync(sidecar, Check);
    Check(ProxyOptions.Parse(Parse()) is null, "Direct transport by default");
    var proxy = ProxyOptions.Parse(Parse("--proxy-host", "localhost", "--proxy-port", "8080", "--proxy-username", "cli-user", "--proxy-password", "cli-password"));
    Check(proxy is { Host: "localhost", Port: 8080, Username: "cli-user", Password: "cli-password" }, "CLI proxy fallback");
    Environment.SetEnvironmentVariable(variables[1], "env-user");
    Environment.SetEnvironmentVariable(variables[2], "env-password");
    proxy = ProxyOptions.Parse(Parse("--proxy-host", "localhost", "--proxy-port", "8080", "--proxy-username", "cli-user", "--proxy-password", "cli-password"));
    Check(proxy is { Username: "env-user", Password: "env-password" }, "Environment overrides CLI proxy credentials");
    Environment.SetEnvironmentVariable(variables[1], "");
    Environment.SetEnvironmentVariable(variables[2], "");
    Check(ProxyOptions.Parse(Parse()) is null, "Empty environment credentials allow direct transport");
    foreach (var input in new[] { Parse("--proxy-port", "8080"), Parse("--proxy-host", "localhost"), Parse("--proxy-host", "localhost", "--proxy-port", "0"), Parse("--proxy-host", "localhost", "--proxy-port", "65536"), Parse("--proxy-host", "http://user:password@localhost", "--proxy-port", "8080") })
    {
        try { ProxyOptions.Parse(input); throw new InvalidOperationException("Invalid proxy accepted"); }
        catch (ArgumentException) { assertions++; }
    }
    Check(SpeechConfiguration.GetSpeechKey(Parse("--speech-key", "cli-key")) == "cli-key", "CLI speech key fallback");
    Environment.SetEnvironmentVariable(variables[0], "env-key");
    Check(SpeechConfiguration.GetSpeechKey(Parse("--speech-key", "cli-key")) == "env-key", "Environment speech key overrides CLI");
    var invalid = await SpeechConnectivityDiagnostic.RunFromArgsAsync(Parse("--speech-region", "westeurope", "--speech-endpoint", "https://user:password@localhost"));
    Check(!invalid.reachable && invalid.steps.Any(s => s.step == "speech_config" && s.status == "error"), "Endpoint credentials rejected");
    var originalOut = Console.Out;
    using var output = new StringWriter();
    try
    {
        Console.SetOut(output);
        Logger.ConfigureSecrets("password\"\\secret", "env-key");
        Logger.Event("speech_connectivity", new { reachable = false, steps = new[] { new { step = "validation", status = "error", detail = "password\"\\secret env-key" } } });
    }
    finally { Console.SetOut(originalOut); Logger.ConfigureSecrets(); }
    using var redacted = JsonDocument.Parse(output.ToString());
    Check(redacted.RootElement.GetProperty("type").GetString() == "speech_connectivity", "JSON event type preserved");
    Check(redacted.RootElement.GetProperty("payload").GetProperty("steps")[0].GetProperty("detail").GetString() == "[redacted] [redacted]", "Escaped credentials redacted without corrupting JSON");

    using var listener = new TcpListener(IPAddress.Loopback, 0);
    listener.Start();
    var port = ((IPEndPoint)listener.LocalEndpoint).Port;
    using var listenerCancellation = new CancellationTokenSource();
    var connects = 0;
    var server = Task.Run(async () =>
    {
        try
        {
            while (!listenerCancellation.IsCancellationRequested)
            {
                using var client = await listener.AcceptTcpClientAsync(listenerCancellation.Token);
                using var stream = client.GetStream();
                var buffer = new byte[8192];
                var read = await stream.ReadAsync(buffer, listenerCancellation.Token);
                if (Encoding.ASCII.GetString(buffer, 0, read).StartsWith("CONNECT ", StringComparison.Ordinal)) Interlocked.Increment(ref connects);
                await stream.WriteAsync(Encoding.ASCII.GetBytes("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"), listenerCancellation.Token);
            }
        }
        catch (OperationCanceledException) when (listenerCancellation.IsCancellationRequested) { }
    });
    try
    {
        var start = new ProcessStartInfo(sidecar) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };
        ProbeSelfContained(start);
        foreach (var arg in new[] { "--test-connectivity", "--speech-region", "westeurope", "--speech-endpoint", "wss://localhost:443/speech/universal/v2", "--language", "de-DE", "--proxy-host", "127.0.0.1", "--proxy-port", port.ToString() }) start.ArgumentList.Add(arg);
        start.Environment[variables[0]] = "00000000000000000000000000000000";
        start.Environment[variables[1]] = "fake-local-proxy-user";
        start.Environment[variables[2]] = "fake-local-proxy-password";
        using var process = Process.Start(start)!;
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        try { await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(25)); }
        catch { process.Kill(true); throw; }
        var text = await stdout;
        Check(process.ExitCode == 1, "Failed WSS diagnostic exits 1");
        Check(string.IsNullOrEmpty(await stderr), "No stderr diagnostics or credentials");
        Check(text.Split('\n', StringSplitOptions.RemoveEmptyEntries).Length == 1, "Exactly one JSON-Lines event");
        foreach (var secret in start.Environment.Where(p => variables.Contains(p.Key)).Select(p => p.Value!)) Check(!text.Contains(secret, StringComparison.Ordinal), "No secrets in diagnostic output");
        using var json = JsonDocument.Parse(text);
        Check(json.RootElement.GetProperty("type").GetString() == "speech_connectivity", "Diagnostic event shape");
        var result = json.RootElement.GetProperty("payload");
        Check(!result.GetProperty("reachable").GetBoolean(), "Proxy rejection is unreachable");
        var steps = result.GetProperty("steps").EnumerateArray().ToArray();
        foreach (var name in new[] { "speech_recognizer_wss", "conversation_transcriber_wss" })
            Check(steps.Any(s => s.GetProperty("step").GetString() == name && s.GetProperty("status").GetString() == "error"), "Both native SDK paths report failure");
        Check(!steps.Any(s => s.GetProperty("step").GetString() == "speech_tls"), "No static TLS hint step in the diagnostic result");
        Check(connects >= 2, "Both native SDK clients reached the loopback proxy via CONNECT");
    }
    finally
    {
        listenerCancellation.Cancel();
        listener.Stop();
        await server;
    }
    using var silentListener = new TcpListener(IPAddress.Loopback, 0);
    silentListener.Start();
    try
    {
        var silentPort = ((IPEndPoint)silentListener.LocalEndpoint).Port;
        var config = new AzureSpeechConfig($"wss://localhost:{silentPort}/speech/universal/v2", "westeurope", "00000000000000000000000000000000", true, null);
        var timer = Stopwatch.StartNew();
        var timeoutResults = await Task.WhenAll(
            SpeechConnectivityDiagnostic.ProbeAsync(config, "de-DE", false, TimeSpan.FromMilliseconds(100)),
            SpeechConnectivityDiagnostic.ProbeAsync(config, "de-DE", true, TimeSpan.FromMilliseconds(100)));
        // Schranke gegen unbegrenztes Warten: Der eigentliche Timeout-Mechanismus
        // wird durch die Pruefung auf "Timed out" weiter unten belegt. Diese
        // Obergrenze faengt nur einen echten Halt (Aufraeumen ohne Ende) ab und
        // ist bewusst grosszuehlig gewaehlt: Auf belasteten oder geteilten
        // Machines kann das native SDK-Threading beim Start und Stoppen
        // deutlich laenger dauern als auf einem freien System, ohne dass ein
        // Fehler vorliegt.
        Check(timer.Elapsed < TimeSpan.FromSeconds(30), "Native startup and stop waits are bounded");
        foreach (var result in timeoutResults)
            Check(result[0].status == "error" && result[0].detail.Contains("Timed out", StringComparison.Ordinal), "SessionStarted alone cannot make an unconnected WSS socket reachable");
    }
    finally { silentListener.Stop(); }
    Console.WriteLine($"PASS: {assertions} sidecar assertions (local proxy and foreign microphone-session probe; no Azure credentials or audio files).");
}
finally
{
    for (var i = 0; i < variables.Length; i++) Environment.SetEnvironmentVariable(variables[i], previous[i]);
    if (sidecarArg >= 0) File.Delete(probeDeps);
}
