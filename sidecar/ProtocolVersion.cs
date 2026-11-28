namespace MeetingNotes.Sidecar;

/// <summary>
/// Protokollversion zwischen Sidecar und Tauri-Main (T-201).
///
/// Der Sidecar sendet zu Beginn ein <c>handshake</c>-Event mit dieser
/// Version. Die App prueft sie und quittiert mit <c>handshake-ack</c>; eine
/// inkompatible Version beendet den Sidecar.
///
/// Der Wert muss exakt <c>PROTOCOL_VERSION</c> in
/// <c>src-tauri/src/protocol.rs</c> entsprechen.
/// </summary>
public static class ProtocolVersion
{
    /// <summary>Aktuelle Protokollversion des Sidecars.</summary>
    public const string Current = "2.0.0";
}
