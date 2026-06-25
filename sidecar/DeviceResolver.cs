using System;
using System.Linq;
using NAudio.CoreAudioApi;

namespace MeetingNotes.Sidecar;

/// <summary>
/// Resolves and enumerates audio input/output devices via NAudio's
/// MMDeviceEnumerator (WASAPI). Handles missing/default lookup and
/// produces a stable device snapshot for the renderer's device picker.
/// </summary>
public static class DeviceResolver
{
    public sealed record DeviceInfo(string Id, string Name, string Flow, bool IsDefault);

    public sealed record DeviceSnapshot(DeviceInfo[] Inputs, DeviceInfo[] Outputs, string FetchedAtIso);

    public static DeviceSnapshot ListDevices()
    {
        using var mm = new MMDeviceEnumerator();

        string? defaultIn = null;
        string? defaultOut = null;
        try { defaultIn = mm.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Multimedia).ID; } catch { }
        try { defaultOut = mm.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia).ID; } catch { }

        var inputs = mm.EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.Active)
            .Select(d => new DeviceInfo(d.ID, d.FriendlyName, "input", d.ID == defaultIn))
            .ToArray();

        var outputs = mm.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active)
            .Select(d => new DeviceInfo(d.ID, d.FriendlyName, "output", d.ID == defaultOut))
            .ToArray();

        return new DeviceSnapshot(inputs, outputs, DateTimeOffset.UtcNow.ToString("O"));
    }

    public static MMDevice? ResolveInputDevice(MMDeviceEnumerator mm, string? explicitId)
    {
        if (!string.IsNullOrWhiteSpace(explicitId))
        {
            return mm.EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.Active)
                .FirstOrDefault(d => string.Equals(d.ID, explicitId, StringComparison.OrdinalIgnoreCase));
        }
        try { return mm.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Multimedia); } catch { return null; }
    }

    public static MMDevice? ResolveOutputDevice(MMDeviceEnumerator mm, string? explicitId)
    {
        if (!string.IsNullOrWhiteSpace(explicitId))
        {
            return mm.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active)
                .FirstOrDefault(d => string.Equals(d.ID, explicitId, StringComparison.OrdinalIgnoreCase));
        }
        try { return mm.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia); } catch { return null; }
    }
}
