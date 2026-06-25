using System;
using System.Text.Json;

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
        var line = JsonSerializer.Serialize(payload);
        lock (WriteLock)
        {
            Console.WriteLine(line);
            Console.Out.Flush();
        }
    }
}
