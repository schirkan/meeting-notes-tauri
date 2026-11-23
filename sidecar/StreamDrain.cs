namespace MeetingNotes.Sidecar;

// SessionStopped marks the SDK's terminal result boundary. In addition to
// waiting for it, join result handlers already writing to stdout at that point.
internal sealed class StreamDrain
{
    private readonly object _gate = new();
    private TaskCompletionSource? _drained;
    private int _callbacks;
    private bool _terminal;
    private bool _failed;
    private bool _sealed;

    public void OnSessionStarted()
    {
        lock (_gate)
        {
            if (_sealed) return;
            _terminal = false;
            _failed = false;
        }
    }

    public void OnSessionStopped()
    {
        lock (_gate)
        {
            _terminal = true;
            CompleteIfDrained();
        }
    }

    public void Fail()
    {
        lock (_gate) _failed = true;
    }

    public void Emit(Action callback)
    {
        lock (_gate)
        {
            if (_sealed) return;
            _callbacks++;
        }
        try { callback(); }
        catch (Exception ex)
        {
            Fail();
            Logger.Error("AZURE_RECOGNIZER_FAILED", $"Could not emit an Azure result: {ex.Message}");
        }
        finally
        {
            lock (_gate)
            {
                _callbacks--;
                CompleteIfDrained();
            }
        }
    }

    public Task FinishAsync(bool requireTerminal)
    {
        lock (_gate)
        {
            _drained ??= new(TaskCreationOptions.RunContinuationsAsynchronously);
            if (!requireTerminal) _sealed = true;
            CompleteIfDrained();
            return _drained.Task;
        }
    }

    public bool Failed
    {
        get { lock (_gate) return _failed; }
    }

    private void CompleteIfDrained()
    {
        if (_drained is null || (!_terminal && !_sealed)) return;
        _sealed = true;
        if (_callbacks == 0) _drained.TrySetResult();
    }
}
