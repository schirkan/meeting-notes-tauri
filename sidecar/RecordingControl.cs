using System.Threading.Channels;

namespace MeetingNotes.Sidecar;

internal static class RecordingControl
{
    // Rust allows 15 seconds. Use one smaller budget for capture cleanup,
    // an in-flight reconnect, and all recognizers, not a timeout per operation.
    internal static readonly TimeSpan ShutdownBudget = TimeSpan.FromSeconds(10);

    internal static async Task ReadCommandsAsync(TextReader input, Func<string, Task> handle,
        Action requestStop, CancellationToken stopping, Task? recordingReady = null, Action? requestShutdown = null)
    {
        var commands = Channel.CreateUnbounded<string>(new UnboundedChannelOptions { SingleReader = true, SingleWriter = true });
        _ = Task.Run(async () =>
        {
            try
            {
                await foreach (var command in commands.Reader.ReadAllAsync(stopping))
                {
                    if (recordingReady is not null && command != SidecarCommands.HandshakeAck)
                        await recordingReady.WaitAsync(stopping);
                    stopping.ThrowIfCancellationRequested();
                    await handle(command);
                }
            }
            catch (OperationCanceledException) when (stopping.IsCancellationRequested) { }
            catch (Exception ex)
            {
                Logger.Error("SIDECAR_UNAVAILABLE", $"The command handler stopped: {ex.Message}");
                requestStop();
            }
        });

        var shutdownRequested = false;
        try
        {
            while (!stopping.IsCancellationRequested)
            {
                var line = await input.ReadLineAsync(stopping);
                stopping.ThrowIfCancellationRequested();
                var command = SidecarCommands.ReadType(line);
                if (line is null || command == SidecarCommands.Shutdown)
                {
                    shutdownRequested = true;
                    break;
                }
                commands.Writer.TryWrite(command);
            }
        }
        catch (OperationCanceledException) when (stopping.IsCancellationRequested) { }
        finally
        {
            try
            {
                if (shutdownRequested) (requestShutdown ?? requestStop)();
                else if (!stopping.IsCancellationRequested) requestStop();
            }
            finally { commands.Writer.TryComplete(); }
        }
    }

    internal static (Task<T> Owner, Task<T> UntilReady) BeginStereoStartup<T>(
        Func<CancellationToken, Task<T>> start, Action startCommandReader, CancellationToken startup)
    {
        // Shutdown must be readable before either native startup or SessionStarted can block.
        startCommandReader();
        var owner = Task.Run(() => start(startup));
        return (owner, owner.WaitAsync(startup));
    }

    internal static async Task CompleteShutdownAsync(Func<Task> cleanup, CancellationToken deadline,
        Task? startup = null, bool acknowledge = true)
    {
        var work = Task.Run(async () =>
        {
            // Startup owns partially-created handles until native calls return. Even if it
            // fails or outlives the budget, only this worker may then release those handles.
            if (startup is not null) await startup.ConfigureAwait(ConfigureAwaitOptions.SuppressThrowing);
            await cleanup();
        });
        // WaitAsync does not cancel a busy native SDK thread. Never race it by
        // disposing its handles from here, and observe any late fault.
        _ = work.ContinueWith(t => { _ = t.Exception; }, TaskContinuationOptions.OnlyOnFaulted);
        try
        {
            await work.WaitAsync(deadline);
            deadline.ThrowIfCancellationRequested();
        }
        catch (OperationCanceledException) when (deadline.IsCancellationRequested)
        {
            throw new TimeoutException("Timed out waiting for recording shutdown; the final Azure results may be incomplete.");
        }

        if (acknowledge) Logger.Stopped();
    }
}
