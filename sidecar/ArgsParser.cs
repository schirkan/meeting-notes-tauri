using System.Collections.Generic;

namespace MeetingNotes.Sidecar;

/// <summary>
/// Parses sidecar CLI args into a dictionary. Supports both
/// <c>--key value</c> and bare <c>--flag</c> (treated as boolean true).
/// </summary>
public static class ArgsParser
{
    public static Dictionary<string, string?> Parse(string[] args)
    {
        var result = new Dictionary<string, string?>(System.StringComparer.OrdinalIgnoreCase);

        for (var i = 0; i < args.Length; i++)
        {
            var key = args[i];
            if (!key.StartsWith("--", System.StringComparison.Ordinal)) continue;

            var hasValue = i + 1 < args.Length && !args[i + 1].StartsWith("--", System.StringComparison.Ordinal);
            result[key] = hasValue ? args[++i] : "true";
        }

        return result;
    }
}
