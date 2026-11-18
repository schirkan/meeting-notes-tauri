using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using NAudio.CoreAudioApi;

namespace MeetingNotes.Sidecar;

/// <summary>
/// Erkennt im Hintergrund, ob eine Meeting-Anwendung eine Audiositzung
/// oeffnet - ohne Aufnahme und ohne Azure.
/// </summary>
/// <remarks>
/// T-513, Stufe 1: der Core-Audio-Session-Graph. NAudio 3.3.0 liefert ueber
/// <c>MMDevice.AudioSessionManager</c> bereits alles noetige:
/// <list type="bullet">
/// <item><c>OnSessionCreated</c> feuert, sobald ein Prozess eine neue
/// Audiositzung auf dem Endpoint oeffnet (empirisch belegt: das Ereignis
/// feuert auf Capture- und Render-Endpoint).</item>
/// <item><c>AudioSessionControl.GetProcessID</c> liefert die PID des
/// Prozesses - daraus laesst sich der Anwendungsname ableiten.</item>
/// <item><c>AudioSessionControl.State</c> liefert Inactive/Active/Expired.</item>
/// </list>
///
/// Zwei Signale werden getrennt bewertet:
/// <list type="bullet">
/// <item><b>Mic</b>: eine neue Sitzung auf dem Aufnahme-Endpoint. Das ist das
/// starke Signal - wer spricht, oeffnet eine Capture-Sitzung.</item>
/// <item><b>Speaker</b>: eine neue Sitzung auf dem Render-Endpoint. Das ist
/// das schwache Signal - es passt auch zu Musik, Video oder Systemklängen.</item>
/// </list>
///
/// Wichtig: der Prozessname wird ueber die PID aufgeloest, nicht ueber
/// <c>DisplayName</c> - das ist bei eigenen Sitzungen leer, der Prozessname
/// aber verlaesslich.
/// </remarks>
public sealed class MeetingDetector : IDisposable
{
    /// <summary>Wie lange eine Erkennung gegen Duplikate geprueft wird.</summary>
    private static readonly TimeSpan DuplicateWindow = TimeSpan.FromSeconds(90);

    /// <summary>
    /// Prozessnamen, denen eine neue Aufnahme-Sitzung zugerechnet wird.
    /// Leer gesetzt bedeutet: jede neue Capture-Sitzung eines fremden
    /// Prozesses gilt als Meeting-Kandidat.
    /// </summary>
    private static readonly string[] DefaultMeetingProcesses =
    {
        "teams", "zoom", "whatsapp", "slack", "discord", "skype", "webex", "gotomeeting", "zoomify"
    };

    private readonly HashSet<string> _meetingProcesses;
    private readonly Dictionary<string, DateTimeOffset> _recentDetections = new(StringComparer.OrdinalIgnoreCase);
    private readonly Action<MeetingDetection> _onDetected;
    private readonly CancellationTokenSource _cts = new();
    private readonly List<AudioSessionManager> _managers = new();

    /// <summary>
    /// Die beobachteten Endpunkte. Sie muessen am Leben bleiben: der
    /// Session-Manager haelt eine COM-Referenz auf sein Geraet, und ein
    /// freigegebenes Geraet nimmt dem Manager die Ereigniszustellung.
    /// </summary>
    private readonly List<MMDevice> _devices = new();
    private bool _disposed;

    /// <summary>Ergebnis einer Meeting-Erkennung.</summary>
    /// <param name="ProcessName">Prozessname des erkannten Prozesses.</param>
    /// <param name="ProcessId">PID des erkannten Prozesses.</param>
    /// <param name="Signal">"mic" oder "speaker".</param>
    public readonly record struct MeetingDetection(string ProcessName, uint ProcessId, string Signal);

    /// <summary>
    /// Startet die Beobachtung von Aufnahme- und Ausgabe-Endpoint.
    /// </summary>
    /// <param name="onDetected">Wird bei jeder Erkennung aufgerufen.</param>
    /// <param name="meetingProcesses">
    /// Erlaubte Prozessnamen. <c>null</c> nimmt die Standardliste.
    /// </param>
    public MeetingDetector(
        Action<MeetingDetection> onDetected,
        IEnumerable<string>? meetingProcesses = null)
    {
        _onDetected = onDetected;
        _meetingProcesses = new HashSet<string>(
            meetingProcesses ?? DefaultMeetingProcesses,
            StringComparer.OrdinalIgnoreCase);

        try
        {
            var enumerator = new MMDeviceEnumerator();
            _devices.Add(enumerator.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Multimedia));
            _devices.Add(enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia));
            Watch(_devices[0], "mic");
            Watch(_devices[1], "speaker");
        }
        catch (Exception ex)
        {
            Logger.Error("MEETING_DETECTOR_UNAVAILABLE", $"Endpoint-Ueberwachung nicht moeglich: {ex.Message}");
            throw;
        }
    }

    private void Watch(MMDevice device, string signal)
    {
        // Wichtig: der Manager muss ueber die Lebzeit des Geraets gehalten
        // werden - sonst liefert er nach dem Freigeben des Geraets keine
        // Ereignisse mehr.
        var manager = device.AudioSessionManager;
        manager.OnSessionCreated += (_, session) => Handle(session, signal);
        _managers.Add(manager);
        Logger.Info("meeting_detector", "watching", $"Endpoint '{signal}' wird beobachtet.");
    }

    private void Handle(AudioSessionControl session, string signal)
    {
        try
        {
            var processId = session.GetProcessID;
            if (processId == 0) return;

            var processName = ResolveProcessName(processId);
            if (string.IsNullOrEmpty(processName)) return;

            // Eigene Sitzungen der App ignorieren - sonst meldet sich die
            // App selbst als Meeting. Das betrifft den eigenen Prozess und
            // den Sidecar-Prozess, der die Aufnahme startet.
            if (IsOwnProcess(processId)) return;
            if (IsSidecarProcess(processName)) return;

            if (_meetingProcesses.Count > 0 && !_meetingProcesses.Contains(processName))
            {
                Logger.Info(
                    "meeting_detector",
                    "ignored_process",
                    $"Prozess '{processName}' ist nicht als Meeting-Anwendung hinterlegt.");
                return;
            }

            var key = processName + "|" + processId + "|" + signal;
            var now = DateTimeOffset.UtcNow;
            if (_recentDetections.TryGetValue(key, out var previous) && now - previous < DuplicateWindow)
            {
                return;
            }
            _recentDetections[key] = now;

            Logger.Info(
                "meeting_detector",
                "detected",
                $"Meeting-Signal '{signal}' von Prozess '{processName}' (PID {processId}).");

            _onDetected(new MeetingDetection(processName, processId, signal));
        }
        catch (Exception ex)
        {
            Logger.Error("MEETING_DETECTOR_FAILED", $"Sitzung konnte nicht ausgewertet werden: {ex.Message}");
        }
    }

    /// <summary>
    /// Loest den Prozessnamen zur PID auf. Fuer Prozesse, die bereits
    /// beendet sind, liefert die API keine - dann bleibt der Name leer.
    /// </summary>
    private static string ResolveProcessName(uint processId)
    {
        try
        {
            using var process = Process.GetProcessById((int)processId);
            return process.ProcessName;
        }
        catch (ArgumentException)
        {
            return string.Empty;
        }
        catch (InvalidOperationException)
        {
            return string.Empty;
        }
    }

    private static bool IsOwnProcess(uint processId)
    {
        using var current = Process.GetCurrentProcess();
        return current.Id == (int)processId;
    }

    /// <summary>
    /// Erkennt den Aufnahme-Sidecar am Prozessnamen. Startet spaeter der
    /// Aufnahme-Sidecar, wuerde dessen Capture-Sitzung sonst als Meeting
    /// gemeldet. Der Vergleich ist bewusst exakt: "MeetingNotes.Sidecar"
    /// trifft weder den Validierungsprozess
    /// ("MeetingNotes.Sidecar.Validation") noch andere Apps mit aehnlichem
    /// Namenspraefix.
    /// </summary>
    private static bool IsSidecarProcess(string processName)
    {
        return string.Equals(processName, "MeetingNotes.Sidecar", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Liefert die gerade beobachteten Prozessnamen - fuer Diagnose und Tests.
    /// </summary>
    public IReadOnlyCollection<string> WatchedProcesses => _meetingProcesses;

    /// <summary>Beendet die Beobachtung und gibt die Endpunkte frei.</summary>
    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _cts.Cancel();
        foreach (var manager in _managers)
        {
            manager.Dispose();
        }
        _managers.Clear();
        foreach (var device in _devices)
        {
            device.Dispose();
        }
        _devices.Clear();
        _cts.Dispose();
    }
}
