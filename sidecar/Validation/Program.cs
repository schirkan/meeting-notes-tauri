using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using MeetingNotes.Sidecar;

var variables = new[] { "MEETING_NOTES_SPEECH_KEY", "MEETING_NOTES_PROXY_USERNAME", "MEETING_NOTES_PROXY_PASSWORD" };
var previous = variables.Select(Environment.GetEnvironmentVariable).ToArray();
var assertions = 0;
void Check(bool condition, string description)
{
    if (!condition) throw new InvalidOperationException(description);
    assertions++;
}
Dictionary<string, string?> Parse(params string[] args) => ArgsParser.Parse(args);
try
{
    foreach (var variable in variables) Environment.SetEnvironmentVariable(variable, null);
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
        var sidecar = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "bin", "Release", "net8.0-windows", "MeetingNotes.Sidecar.exe"));
        var start = new ProcessStartInfo(sidecar) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
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
        Check(steps.Any(s => s.GetProperty("step").GetString() == "speech_tls" && s.GetProperty("status").GetString() == "warn"), "TLS validation warning present");
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
        Check(timer.Elapsed < TimeSpan.FromSeconds(6), "Native startup and stop waits are bounded");
        foreach (var result in timeoutResults)
            Check(result[0].status == "error" && result[0].detail.Contains("Timed out", StringComparison.Ordinal), "SessionStarted alone cannot make an unconnected WSS socket reachable");
    }
    finally { silentListener.Stop(); }
    Console.WriteLine($"PASS: {assertions} sidecar assertions (loopback proxy only; no audio capture or Azure credentials).");
}
finally
{
    for (var i = 0; i < variables.Length; i++) Environment.SetEnvironmentVariable(variables[i], previous[i]);
}
