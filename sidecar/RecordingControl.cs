using System.Threading.Channels;

namespace MeetingNotes.Sidecar;

internal static class RecordingControl
{
    // Rust allows 15 seconds. Use one smaller budget for capture cleanup,
    // an in-flight reconnect, and all recognizers, not a timeout per operation.
    internal static readonly TimeSpan ShutdownBudget = TimeSpan.FromSeconds(10);

    internal static async Task ReadCommandsAsync(TextReader input, Func<string, Task> handle,
        Action requestStop, CancellationToken stopping)
    {
        var commands = Channel.CreateUnbounded<string>(new UnboundedChannelOptions { SingleReader = true, SingleWriter = true });
        _ = Task.Run(async () =>
        {
            try
            {
                await foreach (var command in commands.Reader.ReadAllAsync(stopping))
                {
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

        try
        {
            while (!stopping.IsCancellationRequested)
            {
                var line = await input.ReadLineAsync(stopping);
                if (line is null) break;
                var command = SidecarCommands.ReadType(line);
                if (command == SidecarCommands.Shutdown) break;
                commands.Writer.TryWrite(command);
            }
        }
        catch (OperationCanceledException) when (stopping.IsCancellationRequested) { }
        finally
        {
            requestStop();
            commands.Writer.TryComplete();
        }
    }

    internal static async Task CompleteShutdownAsync(Func<Task> cleanup, CancellationToken deadline)
    {
        var work = Task.Run(cleanup);
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

        Logger.Stopped();
    }
}
