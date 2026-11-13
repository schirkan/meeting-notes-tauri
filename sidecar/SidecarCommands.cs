using System.Text.Json;

namespace MeetingNotes.Sidecar;

/// <summary>
/// Liest den Kommandotyp aus einer JSON-Lines-Zeile, die der Tauri-Main
/// ueber stdin an den laufenden Sidecar sendet (T-507).
/// </summary>
public static class SidecarCommands
{
    public const string Pause = "pause";
    public const string Resume = "resume";
    public const string Shutdown = "shutdown";
    public const string Reset = "reset";
    public const string Unknown = "unknown";

    /// <summary>
    /// Gibt den Kommandotyp in Kleinschreibung zurueck. Ungueltiges JSON
    /// oder ein fehlendes `type` ergeben <see cref="Unknown"/>.
    /// </summary>
    public static string ReadType(string? line)
    {
        if (string.IsNullOrWhiteSpace(line)) return Unknown;
        try
        {
            using var document = JsonDocument.Parse(line);
            if (document.RootElement.ValueKind != JsonValueKind.Object) return Unknown;
            if (!document.RootElement.TryGetProperty("type", out var type)) return Unknown;
            if (type.ValueKind != JsonValueKind.String) return Unknown;
            var value = type.GetString();
            return string.IsNullOrWhiteSpace(value) ? Unknown : value.Trim().ToLowerInvariant();
        }
        catch (JsonException)
        {
            return Unknown;
        }
    }
}
