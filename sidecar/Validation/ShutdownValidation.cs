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

            foreach (var waitForSession in new[] { false, true })
            {
                output.GetStringBuilder().Clear();
                await CheckStereoStartupShutdownAsync(waitForSession, check, watchdog.Token);
                var lines = output.ToString().Split('\n', StringSplitOptions.RemoveEmptyEntries);
                check(lines.Length == 1, "Clean early Stereo Stop emits exactly one ACK");
                using var stopped = JsonDocument.Parse(lines[0]);
                var payload = stopped.RootElement.GetProperty("payload");
                check(stopped.RootElement.GetProperty("type").GetString() == "status" &&
                    payload.GetProperty("phase").GetString() == "stopped" && !payload.GetProperty("running").GetBoolean(),
                    "Clean early Stereo Stop emits a structured stopped ACK");
            }

            output.GetStringBuilder().Clear();
            var nativeStart = NewSignal();
            var lateCleanup = NewSignal();
            using var startupDeadline = new CancellationTokenSource();
            var bounded = RecordingControl.CompleteShutdownAsync(() =>
            {
                lateCleanup.SetResult();
                return Task.CompletedTask;
            }, startupDeadline.Token, nativeStart.Task);
            try
            {
                startupDeadline.Cancel();
                await bounded.WaitAsync(watchdog.Token);
                check(false, "A hung startup was reported as a clean stop");
            }
            catch (TimeoutException)
            {
                check(!lateCleanup.Task.IsCompleted && output.ToString().Length == 0,
                    "A stuck native start times out without ACK or concurrent handle disposal");
            }
            finally { nativeStart.TrySetResult(); }
            await lateCleanup.Task.WaitAsync(watchdog.Token);
            check(output.ToString().Length == 0, "Late cleanup after a startup timeout cannot emit a stopped ACK");
        }
        finally
        {
            Console.SetOut(originalOut);
            Logger.ConfigureSecrets();
        }
    }

    private static async Task CheckStereoStartupShutdownAsync(bool waitForSession, Action<bool, string> check,
        CancellationToken watchdog)
    {
        using var stopping = new CancellationTokenSource();
        var nativeRelease = NewSignal();
        var stageEntered = NewSignal();
        var handshake = NewSignal();
        var readyForCommands = NewSignal();
        var explicitStop = false;
        var normalCommandRan = false;
        Task? reader = null;
        async Task<int> StartAsync(CancellationToken startupToken)
        {
            check(reader is not null, "Stereo launches the command reader before native startup");
            stageEntered.SetResult();
            if (waitForSession) await nativeRelease.Task.WaitAsync(startupToken); // SessionStarted never arrives.
            else await nativeRelease.Task; // An in-flight SDK call cannot be canceled.
            startupToken.ThrowIfCancellationRequested();
            return 0;
        }

        using var input = new StartupShutdownReader(Task.WhenAll(stageEntered.Task, handshake.Task));
        void StartReader() => reader = RecordingControl.ReadCommandsAsync(input, command =>
        {
            if (command == SidecarCommands.HandshakeAck) handshake.SetResult();
            else normalCommandRan = true;
            return Task.CompletedTask;
        }, stopping.Cancel, stopping.Token, readyForCommands.Task, () =>
        {
            explicitStop = true;
            stopping.Cancel();
        });

        var (startup, startupWait) = RecordingControl.BeginStereoStartup(StartAsync, StartReader, stopping.Token);
        try
        {
            await (reader ?? throw new InvalidOperationException("Stereo command reader did not start.")).WaitAsync(watchdog);
            try
            {
                await startupWait.WaitAsync(watchdog);
                check(false, "Stereo unexpectedly completed startup before Stop");
            }
            catch (OperationCanceledException) when (stopping.IsCancellationRequested && !watchdog.IsCancellationRequested)
            {
                check(explicitStop && !normalCommandRan, waitForSession
                    ? "Stop/Quit preempts the Stereo SessionStarted wait; early Resume stays deferred"
                    : "Stop/Quit preempts the native Stereo startup wait; early Resume stays deferred");
            }

            var shutdown = RecordingControl.CompleteShutdownAsync(() =>
            {
                check(startup.IsCompleted, "Early Stereo Stop cleans up only after startup releases ownership");
                return Task.CompletedTask;
            }, watchdog, startup);
            if (!waitForSession) nativeRelease.SetResult();
            await shutdown.WaitAsync(watchdog);
        }
        finally { nativeRelease.TrySetResult(); }
    }

    private static TaskCompletionSource NewSignal() => new(TaskCreationOptions.RunContinuationsAsynchronously);

    private sealed class StartupShutdownReader(Task stageEntered) : TextReader
    {
        private int _reads;

        public override async ValueTask<string?> ReadLineAsync(CancellationToken cancellationToken)
        {
            if (_reads++ == 0) return "{\"type\":\"handshake-ack\"}";
            await stageEntered.WaitAsync(cancellationToken);
            return _reads == 2 ? "{\"type\":\"resume\"}" : "{\"type\":\"shutdown\"}";
        }
    }

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
