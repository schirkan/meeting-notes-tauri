using System.Text.Json;
using MeetingNotes.Sidecar;

internal static class ShutdownValidation
{
    public static async Task RunAsync(Action<bool, string> check)
    {
        using var watchdog = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var originalOut = Console.Out;
        using var output = new StringWriter();
        try
        {
            Console.SetOut(output);
            Logger.ConfigureSecrets("status", "stopped");
            var drain = new StreamDrain();
            drain.OnSessionStopped();
            drain.OnSessionStarted(); // A previous session's terminal signal is not enough.
            var entered = NewSignal();
            var release = NewSignal();
            var result = Task.Run(() => drain.Emit(() =>
            {
                entered.SetResult();
                release.Task.GetAwaiter().GetResult();
                Logger.Event("transcript", new { text = "status stopped" });
            }));
            try
            {
                await entered.Task.WaitAsync(watchdog.Token);
                var terminal = drain.FinishAsync(requireTerminal: true);
                var shutdown = RecordingControl.CompleteShutdownAsync(() => terminal, watchdog.Token);
                check(!terminal.IsCompleted, "Final drain requires the current session's terminal event");
                check(output.ToString().Length == 0, "No ACK while results are still pending");
                drain.OnSessionStopped();
                check(!terminal.IsCompleted, "Terminal event does not skip an in-flight result handler");
                release.SetResult();
                await shutdown;
                drain.Emit(() => throw new InvalidOperationException("Late SDK callback was accepted"));
                await result;

                var lines = output.ToString().Split('\n', StringSplitOptions.RemoveEmptyEntries);
                check(lines.Length == 2, "One transcript, then exactly one stop ACK; late callback sealed");
                using var final = JsonDocument.Parse(lines[0]);
                check(final.RootElement.GetProperty("type").GetString() == "transcript" &&
                      final.RootElement.GetProperty("payload").GetProperty("text").GetString() == "[redacted] [redacted]",
                    "Final result arrives first, with free text still redacted");
                using var ack = JsonDocument.Parse(lines[1]);
                var payload = ack.RootElement.GetProperty("payload");
                check(ack.RootElement.GetProperty("type").GetString() == "status" &&
                      payload.GetProperty("phase").GetString() == "stopped" && !payload.GetProperty("running").GetBoolean(),
                    "Stop ACK retains exact fields despite colliding secrets");
            }
            finally { release.TrySetResult(); }

            output.GetStringBuilder().Clear();
            var missingTerminal = new StreamDrain();
            using var deadline = new CancellationTokenSource();
            var pending = RecordingControl.CompleteShutdownAsync(() => missingTerminal.FinishAsync(requireTerminal: true), deadline.Token);
            deadline.Cancel();
            try
            {
                await pending.WaitAsync(watchdog.Token);
                check(false, "Timeout was reported as clean shutdown");
            }
            catch (TimeoutException) { check(output.ToString().Length == 0, "Missing terminal event produces timeout without ACK"); }
            finally { missingTerminal.OnSessionStopped(); }

            try
            {
                await RecordingControl.CompleteShutdownAsync(
                    () => Task.FromException(new InvalidOperationException("native stop failed")), watchdog.Token);
                check(false, "Native stop failure was reported as clean shutdown");
            }
            catch (InvalidOperationException ex) when (ex.Message == "native stop failed")
            {
                check(output.ToString().Length == 0, "Faulted native stop produces no ACK");
            }

            using var stopping = new CancellationTokenSource();
            var resumeEntered = NewSignal();
            var resumeReleased = NewSignal();
            using var input = new ResumeThenShutdownReader(resumeEntered.Task);
            try
            {
                await RecordingControl.ReadCommandsAsync(input, command =>
                {
                    check(command == SidecarCommands.Resume, "Resume executes in command worker");
                    resumeEntered.SetResult();
                    return resumeReleased.Task;
                }, stopping.Cancel, stopping.Token).WaitAsync(watchdog.Token);
                check(stopping.IsCancellationRequested && !resumeReleased.Task.IsCompleted,
                    "Shutdown requests cancellation while Resume is still blocked");
            }
            finally { resumeReleased.TrySetResult(); }
        }
        finally
        {
            Console.SetOut(originalOut);
            Logger.ConfigureSecrets();
        }
    }

    private static TaskCompletionSource NewSignal() => new(TaskCreationOptions.RunContinuationsAsynchronously);

    private sealed class ResumeThenShutdownReader(Task resumeEntered) : TextReader
    {
        private int _reads;

        public override async ValueTask<string?> ReadLineAsync(CancellationToken cancellationToken)
        {
            if (_reads++ == 0) return "{\"type\":\"resume\"}";
            await resumeEntered.WaitAsync(cancellationToken);
            return "{\"type\":\"shutdown\"}";
        }
    }
}
