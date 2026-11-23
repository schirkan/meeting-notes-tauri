using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;
using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;

namespace MeetingNotes.Sidecar;

/// <summary>
/// Observes Core Audio metadata without recording or Azure.
/// OnSessionCreated discovers sessions; OnStateChanged reports actual activity.
/// Inactive/Expired and disconnection are audio-session end signals, not proof
/// that a meeting has ended. All sessions of the process must remain inactive
/// for three seconds before an end event is emitted.
/// </summary>
public sealed class MeetingDetector : IDisposable
{
    private static readonly TimeSpan EndGracePeriod = TimeSpan.FromSeconds(3);
    private static readonly string[] DefaultMeetingProcesses =
    {
        "teams", "ms-teams", "zoom", "whatsapp", "slack", "discord", "skype", "webex", "gotomeeting", "zoomify"
    };
    private readonly HashSet<string> _meetingProcesses;
    private readonly Action<MeetingDetection> _onDetected;
    private readonly Action<MeetingEnd> _onEnded;
    private readonly CancellationTokenSource _cts = new();
    private readonly List<AudioSessionManager> _managers = new();
    private readonly List<MMDevice> _devices = new();
    // Keep both COM session and handler alive, then unregister on disposal.
    private readonly Dictionary<long, (AudioSessionControl Session, SessionEvents Handler, SessionKey Key)> _sessions = new();
    private readonly HashSet<SessionKey> _sessionKeys = new();
    private readonly record struct SessionKey(string EndpointId, string InstanceId);
    private readonly MeetingSessionTracker _tracker = new();
    private readonly object _gate = new();
    private long _nextSessionId;
    private bool _disposed;

    public readonly record struct MeetingDetection(string ProcessName, uint ProcessId, string Signal);
    public readonly record struct MeetingEnd(string ProcessName, uint ProcessId, string Signal);

    public MeetingDetector(Action<MeetingDetection> onDetected,
        Action<MeetingEnd>? onEnded = null, IEnumerable<string>? meetingProcesses = null)
    {
        _onDetected = onDetected;
        _onEnded = onEnded ?? (_ => { });
        _meetingProcesses = CreateProcessFilter(meetingProcesses);
        try
        {
            using var enumerator = new MMDeviceEnumerator();
            var watched = WatchEndpoints(enumerator, DataFlow.Capture, "mic") +
                WatchEndpoints(enumerator, DataFlow.Render, "speaker");
            if (watched == 0)
                throw new InvalidOperationException("No active audio endpoint could be monitored.");
        }
        catch (Exception ex)
        {
            Dispose();
            Logger.Error("MEETING_DETECTOR_UNAVAILABLE", $"Endpoint monitoring is not possible: {ex.Message}");
            throw;
        }
    }

    internal static HashSet<string> CreateProcessFilter(IEnumerable<string>? meetingProcesses = null) =>
        new(meetingProcesses ?? DefaultMeetingProcesses, StringComparer.OrdinalIgnoreCase);

    private int WatchEndpoints(MMDeviceEnumerator enumerator, DataFlow flow, string signal)
    {
        var watched = 0;
        try
        {
            using var devices = enumerator.EnumerateAudioEndPoints(flow, DeviceState.Active);
            foreach (var device in devices)
            {
                _devices.Add(device);
                try
                {
                    Watch(device, signal);
                    watched++;
                }
                catch (Exception ex)
                {
                    Logger.Error("MEETING_DETECTOR_FAILED", $"A '{signal}' endpoint could not be monitored: {ex.Message}");
                }
            }
        }
        catch (Exception ex)
        {
            Logger.Error("MEETING_DETECTOR_FAILED", $"The '{signal}' endpoints could not be enumerated: {ex.Message}");
        }
        return watched;
    }

    private void Watch(MMDevice device, string signal)
    {
        var endpointId = device.ID;
        var manager = device.AudioSessionManager;
        _managers.Add(manager);
        manager.OnSessionCreated += (_, session) => Track(session, endpointId, signal);
        // Subscribe first, then enumerate: apps may reuse a session created before us.
        manager.RefreshSessions();
        var existing = manager.Sessions;
        var count = existing.Count;
        for (var i = 0; i < count; i++) Track(existing[i], endpointId, signal);
        Logger.Info("meeting_detector", "watching", $"A '{signal}' endpoint is being watched.");
    }

    private void Track(AudioSessionControl session, string endpointId, string signal)
    {
        var retained = false;
        try
        {
            var processId = session.GetProcessID;
            if (processId == 0 || processId == (uint)Environment.ProcessId) return;
            var processName = ResolveProcessName(processId);
            if (string.IsNullOrEmpty(processName) ||
                string.Equals(processName, "MeetingNotes.Sidecar", StringComparison.OrdinalIgnoreCase) ||
                (_meetingProcesses.Count > 0 && !_meetingProcesses.Contains(processName))) return;

            lock (_gate)
            {
                if (_disposed) return;
                var key = new SessionKey(endpointId, session.GetSessionInstanceIdentifier);
                if (_sessionKeys.Contains(key)) return;
                var id = ++_nextSessionId;
                var handler = new SessionEvents(this, id);
                session.RegisterEventClient(handler);
                _sessionKeys.Add(key);
                _tracker.Track(id, processId, processName, signal);
                _sessions.Add(id, (session, handler, key));
                retained = true;
                // Creation may precede Active; also handle an already-active session.
                Update(id, session.State == AudioSessionState.AudioSessionStateActive);
            }
        }
        catch (Exception ex)
        {
            Logger.Error("MEETING_DETECTOR_FAILED", $"The session could not be evaluated: {ex.Message}");
        }
        finally
        {
            if (!retained) session.Dispose();
        }
    }

    private void Update(long id, bool active)
    {
        lock (_gate)
        {
            if (_disposed) return;
            var change = _tracker.SetActive(id, active);
            if (change.Started is { } detection)
            {
                Logger.Info("meeting_detector", "detected",
                    $"Meeting signal '{detection.Signal}' from process '{detection.ProcessName}' (PID {detection.ProcessId}).");
                _onDetected(detection);
            }
            if (change.EndCandidate)
                _ = ConfirmEndAsync(change.ProcessId, change.Revision, _cts.Token);
        }
    }

    private async Task ConfirmEndAsync(uint processId, long revision, CancellationToken token)
    {
        try
        {
            await Task.Delay(EndGracePeriod, token);
            lock (_gate)
            {
                if (_disposed || _tracker.ConfirmEnd(processId, revision) is not { } ended) return;
                Logger.Info("meeting_detector", "ended",
                    $"The audio sessions of '{ended.ProcessName}' (PID {ended.ProcessId}) have been inactive for 3 seconds.");
                _onEnded(ended);
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            Logger.Error("MEETING_DETECTOR_FAILED", $"The session end could not be evaluated: {ex.Message}");
        }
    }

    private sealed class SessionEvents(MeetingDetector detector, long id) : IAudioSessionEventsHandler
    {
        public void OnStateChanged(AudioSessionState state)
        {
            if (state == AudioSessionState.AudioSessionStateExpired) detector.Terminate(id);
            else detector.Update(id, state == AudioSessionState.AudioSessionStateActive);
        }
        public void OnSessionDisconnected(AudioSessionDisconnectReason reason) => detector.Terminate(id);
        public void OnVolumeChanged(float volume, bool isMuted) { }
        public void OnDisplayNameChanged(string displayName) { }
        public void OnIconPathChanged(string iconPath) { }
        public void OnChannelVolumeChanged(uint count, IntPtr volumes, uint index) { }
        public void OnGroupingParamChanged(ref Guid groupingId) { }
    }

    private void Terminate(long id)
    {
        lock (_gate)
        {
            if (_disposed || !_sessions.Remove(id, out var tracked)) return;
            Update(id, false);
            _tracker.Remove(id);
            _sessionKeys.Remove(tracked.Key);
            // Unregistration can wait for this callback; never do it inside the callback.
            _ = Task.Run(() => Release(tracked.Session, tracked.Handler));
        }
    }

    private static void Release(AudioSessionControl session, SessionEvents handler)
    {
        try { session.UnRegisterEventClient(handler); } catch { }
        try { session.Dispose(); } catch { }
    }

    private static string ResolveProcessName(uint processId)
    {
        try
        {
            using var process = Process.GetProcessById((int)processId);
            return process.ProcessName;
        }
        catch (ArgumentException) { return string.Empty; }
        catch (InvalidOperationException) { return string.Empty; }
    }

    public IReadOnlyCollection<string> WatchedProcesses => _meetingProcesses;

    public void Dispose()
    {
        (AudioSessionControl Session, SessionEvents Handler, SessionKey Key)[] sessions;
        lock (_gate)
        {
            if (_disposed) return;
            _disposed = true;
            _cts.Cancel();
            sessions = new List<(AudioSessionControl, SessionEvents, SessionKey)>(_sessions.Values).ToArray();
            _sessions.Clear();
            _sessionKeys.Clear();
        }
        // No COM calls while holding the callback lock (unregistration may wait).
        foreach (var (session, handler, _) in sessions) Release(session, handler);
        foreach (var manager in _managers) manager.Dispose();
        _managers.Clear();
        foreach (var device in _devices) device.Dispose();
        _devices.Clear();
        _cts.Dispose();
    }
}
