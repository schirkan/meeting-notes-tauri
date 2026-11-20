using MeetingNotes.Sidecar;

internal static class MeetingDetectionValidation
{
    public static void Run(Action<bool, string> check)
    {
        var defaults = MeetingDetector.CreateProcessFilter();
        check(defaults.Contains("MS-Teams"), "Default process filter recognizes new Microsoft Teams case-insensitively");
        check(defaults.Contains("teams"), "Default process filter still recognizes classic Teams");
        check(!defaults.Contains("ms-teamsupdate") && !defaults.Contains("msedgewebview2"),
            "Default process filter does not match the Teams updater or shared WebView2 process");
        var custom = MeetingDetector.CreateProcessFilter(new[] { "zoom" });
        check(custom.Contains("zoom") && !custom.Contains("ms-teams"), "Custom process filter replaces defaults");

        var tracker = new MeetingSessionTracker();
        tracker.Track(1, 100, "teams", "mic");
        tracker.Track(2, 100, "teams", "speaker");
        tracker.Track(3, 200, "zoom", "mic");
        check(tracker.SetActive(1, false).Started is null, "Inactive creation does not start recording");
        var first = tracker.SetActive(1, true);
        check(first.Started is { ProcessId: 100, Signal: "mic" }, "Active session starts its identified process");
        check(tracker.SetActive(1, true).Started is null, "Duplicate active notification is ignored");
        check(tracker.SetActive(2, true).Started is null, "Second session does not start another recording");
        check(!tracker.SetActive(1, false).EndCandidate, "Live render session prevents microphone-end stop");
        var end = tracker.SetActive(2, false);
        check(end.EndCandidate, "Last inactive session produces an end candidate");
        tracker.SetActive(1, true);
        check(tracker.ConfirmEnd(100, end.Revision) is null, "Reactivation cancels an old end ticket");
        var otherStart = tracker.SetActive(3, true);
        check(otherStart.Started is { ProcessId: 200 }, "Other process has independent identity");
        var otherEnd = tracker.SetActive(3, false);
        check(tracker.ConfirmEnd(200, otherEnd.Revision) is { ProcessId: 200 }, "Other process end cannot be attributed to Teams");
        check(tracker.ConfirmEnd(100, end.Revision) is null, "Other process end does not stop active Teams");
        var final = tracker.SetActive(1, false);
        check(tracker.ConfirmEnd(100, final.Revision) is { ProcessName: "teams", ProcessId: 100, Signal: "mic" },
            "End retains exact initiating process and signal");
        check(tracker.ConfirmEnd(100, final.Revision) is null, "Duplicate end is ignored");
        check(tracker.SetActive(1, true).Started is { ProcessId: 100 }, "Reused session starts the next meeting");
        check(!tracker.SetActive(999, false).EndCandidate, "Unknown session cannot end a meeting");
        var terminalEnd = tracker.SetActive(1, false);
        tracker.Remove(1);
        check(tracker.ConfirmEnd(100, terminalEnd.Revision) is { ProcessId: 100 }, "Terminal session cleanup preserves its pending end");
        check(tracker.SetActive(1, true).Started is null, "Removed terminal session cannot reactivate");
    }

    public static async Task RunExistingSessionAsync(string sidecar, Action<bool, string> check)
    {
        using var enumerator = new NAudio.CoreAudioApi.MMDeviceEnumerator();
        using var mic = enumerator.GetDefaultAudioEndpoint(NAudio.CoreAudioApi.DataFlow.Capture, NAudio.CoreAudioApi.Role.Multimedia);
        using var recorder = new NAudio.Wave.WasapiRecorderBuilder().WithDevice(mic)
            .WithSharedMode().WithEventSync().WithFormat(new NAudio.Wave.WaveFormat(8000, 16, 1)).Build();
        recorder.StartRecording(); // Session exists BEFORE detector startup.
        var ownName = System.Diagnostics.Process.GetCurrentProcess().ProcessName;
        var start = new System.Diagnostics.ProcessStartInfo(sidecar)
        {
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
            UseShellExecute = false, CreateNoWindow = true
        };
        foreach (var argument in new[] { "--detect-only", "--meeting-processes", ownName }) start.ArgumentList.Add(argument);
        using var process = System.Diagnostics.Process.Start(start)!;
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        try
        {
            await process.StandardInput.WriteLineAsync("{\"type\":\"handshake-ack\"}");
            await Task.Delay(TimeSpan.FromSeconds(3));
            recorder.StopRecording();
            await Task.Delay(TimeSpan.FromSeconds(1));
            recorder.StartRecording(); // Reuse same session; short inactivity must not end it.
            await Task.Delay(TimeSpan.FromSeconds(1));
            recorder.StopRecording();
            await Task.Delay(TimeSpan.FromSeconds(5));
            await process.StandardInput.WriteLineAsync("{\"type\":\"shutdown\"}");
            await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(8));
            var documents = (await stdout).Split('\n', StringSplitOptions.RemoveEmptyEntries)
                .Select(line => System.Text.Json.JsonDocument.Parse(line)).ToArray();
            try
            {
                var events = documents.Select(d => d.RootElement).ToArray();
                check(events.Count(e => e.GetProperty("type").GetString() == "meeting_detected") == 1,
                    "Existing session is discovered and reactivation is not a duplicate meeting");
                check(events.Count(e => e.GetProperty("type").GetString() == "meeting_ended") == 1,
                    "Short session inactivity is cancelled and final inactivity emits one end");
                check(process.ExitCode == 0 && string.IsNullOrEmpty(await stderr), "Existing-session detector exits cleanly");
            }
            finally { foreach (var document in documents) document.Dispose(); }
        }
        finally
        {
            if (!process.HasExited) { process.Kill(true); await process.WaitForExitAsync(); }
        }
    }
}
