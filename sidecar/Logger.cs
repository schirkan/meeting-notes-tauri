using System;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace MeetingNotes.Sidecar;

/// <summary>
/// Writes JSON-Lines log entries to <see cref="Console.Out"/>.
/// Single-writer guarded by a lock so concurrent capture/event threads
/// never produce torn lines. Flushes after every write so the Tauri
/// parent sees entries immediately.
/// </summary>
public static class Logger
{
    private static readonly object WriteLock = new();
    private static string[] _secrets = Array.Empty<string>();
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        Converters = { new RedactingStringConverter() }
    };

    public static void ConfigureSecrets(params string?[] secrets)
    {
        lock (WriteLock)
            _secrets = secrets.Where(s => !string.IsNullOrEmpty(s))
                .Select(s => s!).Distinct().OrderByDescending(s => s.Length).ToArray();
    }

    public static void Info(string type, string code, string message)
        => Write(new { type, level = "info", code, message });

    public static void Warn(string type, string code, string message)
        => Write(new { type, level = "warn", code, message });

    public static void Error(string code, string message)
        => Write(new { type = "error", level = "error", code, message });

    public static void Debug(string type, string code, string message)
        => Write(new { type, level = "debug", code, message });

    /// <summary>Emit a typed event with arbitrary payload (status, transcript, …).</summary>
    public static void Event<T>(string type, T payload)
    {
        var wrapped = new { type, payload };
        Write(wrapped);
    }

    private static void Write<T>(T payload)
    {
        lock (WriteLock)
        {
            Console.WriteLine(JsonSerializer.Serialize(payload, JsonOptions));
            Console.Out.Flush();
        }
    }

    private sealed class RedactingStringConverter : JsonConverter<string>
    {
        public override string? Read(ref Utf8JsonReader reader, Type type, JsonSerializerOptions options)
            => reader.GetString();

        public override void Write(Utf8JsonWriter writer, string value, JsonSerializerOptions options)
        {
            foreach (var secret in _secrets)
                value = value.Replace(secret, "[redacted]", StringComparison.Ordinal);
            writer.WriteStringValue(value);
        }
    }
}
