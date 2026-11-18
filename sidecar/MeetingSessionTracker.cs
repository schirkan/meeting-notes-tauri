using System;
using System.Collections.Generic;
using System.Linq;

namespace MeetingNotes.Sidecar;

/// <summary>Session identity and activity, independent of COM and timers.</summary>
public sealed class MeetingSessionTracker
{
    private sealed record Session(uint ProcessId, string ProcessName, string Signal)
    {
        public bool Active { get; set; }
    }
    private sealed class Group
    {
        public long Revision;
        public MeetingDetector.MeetingDetection? Detection;
    }
    private readonly Dictionary<long, Session> _sessions = new();
    private readonly Dictionary<uint, Group> _groups = new();

    public void Track(long id, uint processId, string processName, string signal)
    {
        _sessions.Add(id, new Session(processId, processName, signal));
        _groups.TryAdd(processId, new Group());
    }

    public (MeetingDetector.MeetingDetection? Started, uint ProcessId, long Revision, bool EndCandidate)
        SetActive(long id, bool active)
    {
        if (!_sessions.TryGetValue(id, out var session) || session.Active == active)
            return default;
        session.Active = active;
        var group = _groups[session.ProcessId];
        group.Revision++;
        MeetingDetector.MeetingDetection? started = null;
        if (active && group.Detection is null)
        {
            started = new(session.ProcessName, session.ProcessId, session.Signal);
            group.Detection = started;
        }
        return (started, session.ProcessId, group.Revision,
            group.Detection is not null && !HasActiveSession(session.ProcessId));
    }

    // Called after the grace period. Any intervening activity invalidates the ticket.
    public MeetingDetector.MeetingEnd? ConfirmEnd(uint processId, long revision)
    {
        if (!_groups.TryGetValue(processId, out var group) || group.Revision != revision ||
            group.Detection is not { } detection || HasActiveSession(processId))
            return null;
        group.Detection = null;
        return new(detection.ProcessName, detection.ProcessId, detection.Signal);
    }

    // Terminal sessions are removed only after SetActive(false); pending end tickets remain valid.
    public void Remove(long id) => _sessions.Remove(id);

    private bool HasActiveSession(uint processId) =>
        _sessions.Values.Any(session => session.ProcessId == processId && session.Active);
}
