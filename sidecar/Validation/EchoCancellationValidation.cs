using System.Runtime.InteropServices;
using MeetingNotes.Sidecar;

internal static class EchoCancellationValidation
{
    private const int Rate = 16000;
    private const int Frame = Rate / 100;
    private const int Delay = 641; // non-frame-aligned, about 40 ms

    private static long At(int sample) => TimeSpan.TicksPerSecond + sample * TimeSpan.TicksPerSecond / Rate;
    private static byte[] Pcm(short[] samples) => MemoryMarshal.AsBytes(samples.AsSpan()).ToArray();
    private static double Energy(byte[] pcm) => Error(pcm, null);
    private static double Error(byte[] pcm, byte[]? expected)
    {
        var samples = MemoryMarshal.Cast<byte, short>(pcm.AsSpan());
        var target = expected is null ? default : MemoryMarshal.Cast<byte, short>(expected.AsSpan());
        double energy = 0;
        for (var i = 0; i < samples.Length; i++)
        {
            var delta = samples[i] - (expected is null ? 0 : target[i]);
            energy += (double)delta * delta;
        }
        return energy;
    }

    internal static void Run(Action<bool, string> check)
    {
        var both = new TranscriptionSettings(true, true);
        var enabled = ArgsParser.Parse(new[] { "--echo-cancellation", "true" });
        check(!ArgsParser.ParseEchoCancellation(ArgsParser.Parse([]), both), "Echo cancellation is off by default");
        check(!ArgsParser.ParseEchoCancellation(ArgsParser.Parse(["--echo-cancellation", "false"]), both), "Explicit false stays off with both sources");
        check(ArgsParser.ParseEchoCancellation(enabled, both), "Explicit true opts in with both sources");
        check(!ArgsParser.ParseEchoCancellation(enabled, new(true, false)) &&
            !ArgsParser.ParseEchoCancellation(enabled, new(false, true)) &&
            !ArgsParser.ParseEchoCancellation(enabled, new(false, false)), "AEC does not run without both sources");
        var rejected = false;
        try { ArgsParser.ParseEchoCancellation(ArgsParser.Parse(["--echo-cancellation", "maybe"]), both); }
        catch (ArgumentException) { rejected = true; }
        check(rejected, "Invalid explicit echo cancellation option is rejected");

        var far = Signal(0xa1ce, 12 * Rate);
        var near = Signal(0x5eed, far.Length);
        byte[] Far(int start, int count = Frame) => Pcm(far.AsSpan(start, count).ToArray());
        byte[] Near(int start, int count = Frame, double gain = 1) => Pcm(Build(start, count, p => gain * near[p]));
        byte[] Mic(int start, int count = Frame, double echo = 0.55, double voice = 0, int shift = Delay) =>
            Pcm(Build(start, count, p => (p >= shift ? echo * far[p - shift] : 0) + voice * near[p]));
        void Feed(EchoCancellation filter, int first, int after)
        {
            for (var sample = first * Frame; sample < after * Frame; sample += Frame)
            {
                filter.AddReference(Far(sample), At(sample));
                _ = filter.ProcessMic(Mic(sample), At(sample));
            }
        }

        var filter = new EchoCancellation(Rate);
        var first = Mic(0);
        check(filter.State == EchoCancellation.Phase.WarmingUp, "Session starts in warm-up");
        check(ReferenceEquals(filter.ProcessMic(first, At(0)), first) && filter.State == EchoCancellation.Phase.Bypass,
            "Missing initial reference bypasses without changing a Mic byte");
        var bypassStats = filter.TakeDiagnosticSummary();
        check(bypassStats is not null && bypassStats.Contains("filtered=0/1 blocks") &&
            bypassStats.Contains("ReferenceUnavailable=1") && bypassStats.Contains("candidateDelayMs=n/a") &&
            bypassStats.Contains("micReductionDb=n/a") && filter.TakeDiagnosticSummary() is null,
            "AEC diagnostics report missing reference and drain the interval once");
        double before = 0, after = 0;
        var speakerIntact = true;
        var originalsIntact = true;
        var warmupIntact = true;
        for (var n = 1; n < 70; n++)
        {
            var sample = n * Frame;
            var speakerPcm = Far(sample);
            var mic = Mic(sample);
            filter.AddReference(speakerPcm, At(sample));
            var output = filter.ProcessMic(mic, At(sample));
            speakerIntact &= speakerPcm.SequenceEqual(Far(sample));
            originalsIntact &= mic.SequenceEqual(Mic(sample));
            if (n <= 5) warmupIntact &= ReferenceEquals(mic, output);
            if (n >= 20)
            {
                before += Energy(mic);
                after += Energy(output);
            }
        }
        check(warmupIntact, "Insufficient alignment evidence never alters Mic PCM");
        check(speakerIntact && originalsIntact, "Speaker bytes and input Mic buffers are never mutated");
        check(filter.State == EchoCancellation.Phase.Active && after < 0.06 * before && after > 0.02 * before,
            "Known echo is attenuated by actual subtraction (>12 dB), not muted, across ring wrap");

        _ = filter.TakeDiagnosticSummary();
        before = after = 0;
        for (var n = 70; n < 73; n++)
        {
            var sample = n * Frame;
            var mic = Mic(sample);
            filter.AddReference(Far(sample), At(sample));
            var output = filter.ProcessMic(mic, At(sample));
            before += Energy(mic);
            after += Energy(output);
        }
        var activeStats = filter.TakeDiagnosticSummary();
        var expectedReduction = FormattableString.Invariant($"micReductionDb={10 * Math.Log10(before / after):F2}");
        check(activeStats is not null && activeStats.Contains("filtered=3/3 blocks") &&
            activeStats.Contains("candidateDelayMs=40.06..40.06") && activeStats.Contains("absCorrelation=1.000..1.000") &&
            activeStats.Contains(expectedReduction), "AEC diagnostics report accepted delay and measured Mic reduction");

        before = after = 0;
        for (var n = 73; n < 100; n++)
        {
            var sample = n * Frame;
            var mic = Mic(sample, voice: 0.43);
            var voice = Near(sample, gain: 0.43);
            filter.AddReference(Far(sample), At(sample));
            var output = filter.ProcessMic(mic, At(sample));
            before += Error(mic, voice);
            after += Error(output, voice);
        }
        check(after < 0.15 * before, "Double talk: output is closer to the isolated near voice (>8 dB lower error)");

        _ = filter.TakeDiagnosticSummary();
        var nearIntact = true;
        for (var n = 100; n < 135; n++)
        {
            var sample = n * Frame;
            var mic = Near(sample);
            filter.AddReference(Far(sample), At(sample));
            nearIntact &= ReferenceEquals(filter.ProcessMic(mic, At(sample)), mic);
        }
        check(nearIntact, "Near-only Mic remains byte-identical while unrelated loopback plays");
        var nearStats = filter.TakeDiagnosticSummary();
        check(nearStats is not null && nearStats.Contains("filtered=0/35 blocks") &&
            nearStats.Contains("LowCorrelation=") && nearStats.Contains("micReductionDb=0.00"),
            "AEC diagnostics distinguish low correlation from missing reference and report unchanged Mic level");
        var silenceIntact = true;
        for (var n = 135; n < 150; n++)
        {
            var sample = n * Frame;
            var mic = Near(sample);
            filter.AddReference(new byte[Frame * 2], At(sample));
            silenceIntact &= ReferenceEquals(filter.ProcessMic(mic, At(sample)), mic);
        }
        check(silenceIntact && filter.State != EchoCancellation.Phase.Bypass, "Valid silent reference is not a transport gap");

        Feed(filter, 150, 172);
        check(filter.State == EchoCancellation.Phase.Active, "Aligns again after silence");
        var loud = Mic(172 * Frame, voice: 1.4);
        filter.AddReference(Far(172 * Frame), At(172 * Frame));
        check(ReferenceEquals(filter.ProcessMic(loud, At(172 * Frame)), loud), "Near-dominant double talk is passed through");
        var clipped = Pcm(Build(0, Frame, i => i % 2 == 0 ? short.MaxValue : short.MinValue));
        filter.AddReference(Far(173 * Frame), At(173 * Frame));
        check(ReferenceEquals(filter.ProcessMic(clipped, At(173 * Frame)), clipped), "Clipped Mic block fails open");

        filter.AddReference(Far(174 * Frame), null);
        var valid = Mic(174 * Frame);
        check(ReferenceEquals(filter.ProcessMic(valid, At(174 * Frame)), valid) && filter.State == EchoCancellation.Phase.Bypass,
            "Flagged reference discontinuity immediately invalidates buffered samples");
        Feed(filter, 175, 196);
        valid = Mic(196 * Frame);
        check(filter.State == EchoCancellation.Phase.Active && ReferenceEquals(filter.ProcessMic(valid, null), valid),
            "Mic timing errors also bypass unchanged");
        Feed(filter, 197, 220);
        filter.AddReference(Far(224 * Frame), At(224 * Frame));
        valid = Mic(220 * Frame);
        check(ReferenceEquals(filter.ProcessMic(valid, At(220 * Frame)), valid) && filter.State != EchoCancellation.Phase.Active,
            "Unflagged reference gap must not bridge old and new samples");
        Feed(filter, 225, 250);
        valid = Mic(260 * Frame);
        for (var n = 250; n < 260; n++) _ = filter.ProcessMic(Mic(n * Frame), At(n * Frame));
        check(ReferenceEquals(filter.ProcessMic(valid, At(260 * Frame)), valid) && filter.State == EchoCancellation.Phase.Bypass,
            "Stale reference cannot stay active after the loopback stops producing packets");
        Feed(filter, 259, 280);
        var oversized = new byte[Rate / 5 + 2];
        filter.AddReference(oversized, At(280 * Frame));
        valid = Mic(280 * Frame);
        check(ReferenceEquals(filter.ProcessMic(valid, At(280 * Frame)), valid) && filter.State == EchoCancellation.Phase.Bypass,
            "Oversized reference resets the bounded ring and fails open");
        check(ReferenceEquals(filter.ProcessMic(oversized, At(281 * Frame)), oversized), "Oversized Mic fails open without truncation");
        Feed(filter, 281, 300);
        check(filter.State == EchoCancellation.Phase.Active, "Active before pause");
        filter.SetPaused(true);
        Feed(filter, 300, 320);
        valid = Mic(319 * Frame);
        check(filter.State == EchoCancellation.Phase.Off && ReferenceEquals(filter.ProcessMic(valid, At(319 * Frame)), valid),
            "Pause ignores both capture inputs and discards model state");
        filter.SetPaused(false);
        check(filter.State == EchoCancellation.Phase.WarmingUp, "Resume starts a fresh echo warm-up");
        valid = Mic(320 * Frame);
        check(ReferenceEquals(filter.ProcessMic(valid, At(320 * Frame)), valid), "No pre-pause or paused reference leaks into Resume");
        Feed(filter, 320, 340);
        check(filter.State == EchoCancellation.Phase.Active, "Post-resume reference can establish a new model");
        filter.Stop();
        filter.SetPaused(false);
        filter.Stop();
        Feed(filter, 340, 355);
        valid = Mic(355 * Frame);
        check(filter.State == EchoCancellation.Phase.Off && ReferenceEquals(filter.ProcessMic(valid, At(355 * Frame)), valid),
            "Stop is terminal and ignores later capture callbacks and Resume");

        var contended = new EchoCancellation(Rate);
        Feed(contended, 0, 40);
        _ = contended.TakeDiagnosticSummary();
        // Hold the collector's swap lock on this thread while a Mic packet is processed on another.
        var diagnosticsGate = typeof(EchoCancellation).GetField("_diagnosticsGate",
            System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)?.GetValue(contended)
            ?? throw new InvalidOperationException("AEC diagnostics must not share the processing gate.");
        var echoPacket = Mic(40 * Frame);
        contended.AddReference(Far(40 * Frame), At(40 * Frame));
        byte[] corrected;
        lock (diagnosticsGate)
        {
            // A dedicated thread prevents task inlining from making the Monitor reentrant.
            corrected = Task.Factory.StartNew(() => contended.ProcessMic(echoPacket, At(40 * Frame)),
                CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default)
                .WaitAsync(TimeSpan.FromSeconds(5)).GetAwaiter().GetResult();
        }
        check(contended.State == EchoCancellation.Phase.Active && Energy(corrected) < 0.06 * Energy(echoPacket) &&
            contended.TakeDiagnosticSummary() is null,
            "A contended AEC diagnostics snapshot can skip telemetry, but never disables echo filtering");

        var distantFilter = new EchoCancellation(Rate);
        const int DistantDelay = Rate * 225 / 1000 + 1;
        before = after = 0;
        for (var n = 0; n < 100; n++)
        {
            var sample = n * Frame;
            var mic = Mic(sample, echo: 1.5, shift: DistantDelay);
            distantFilter.AddReference(Far(sample), At(sample));
            var output = distantFilter.ProcessMic(mic, At(sample));
            if (n < 40) continue;
            before += Energy(mic);
            after += Energy(output);
        }
        check(after < 0.06 * before, "AEC attenuates echoes beyond 200 ms with gain above 1.25");

        var reflectionFilter = new EchoCancellation(Rate);
        before = after = 0;
        for (var n = 0; n < 200; n++)
        {
            var sample = n * Frame;
            var mic = Pcm(Build(sample, Frame, p => p < 823 ? 0 : 0.55 * far[p - Delay] + 0.50 * far[p - 823]));
            reflectionFilter.AddReference(Far(sample), At(sample));
            var output = reflectionFilter.ProcessMic(mic, At(sample));
            if (n < 20) continue;
            before += Energy(mic);
            after += Energy(output);
        }
        check(after > 0.20 * before && after < 0.75 * before, "AEC attenuates a near-equal two-path echo without muting Mic");

        // Independent packet sizes and phase, an origin offset, timestamp jitter,
        // gradual sample shift (about 333 ppm), and independent clock drift.
        var driftFilter = new EchoCancellation(Rate);
        const int SpeakerFrame = 113;
        const int MicFrame = 89;
        before = after = 0;
        double lateBefore = 0, lateAfter = 0;
        var render = 0;
        for (var sample = 0; sample < 10 * Rate; sample += MicFrame)
        {
            while (render + SpeakerFrame <= sample + MicFrame)
            {
                var jitter = (render / SpeakerFrame % 5 - 2) * 1200;
                driftFilter.AddReference(Far(render, SpeakerFrame), At(render) + 230_000 + render * 16 / 100 + jitter);
                render += SpeakerFrame;
            }
            var mic = Pcm(Build(sample, MicFrame, p =>
            {
                var index = p - Delay - p / 3000;
                return index < 0 ? 0 : 0.55 * far[index];
            }));
            var output = driftFilter.ProcessMic(mic, At(sample));
            if (sample >= Rate)
            {
                before += Energy(mic);
                after += Energy(output);
            }
            if (sample >= 9 * Rate)
            {
                lateBefore += Energy(mic);
                lateAfter += Energy(output);
            }
        }
        check(after < 0.15 * before && lateAfter < 0.15 * lateBefore,
            "Tracks offset, jitter and limited synthetic clock drift with unequal sub-block packet sizes");
    }

    private static short[] Build(int first, int count, Func<int, double> signal)
    {
        var output = new short[count];
        for (var i = 0; i < count; i++) output[i] = (short)Math.Clamp(Math.Round(signal(first + i)), short.MinValue, short.MaxValue);
        return output;
    }

    private static short[] Signal(uint seed, int count)
    {
        double history = 0;
        return Build(0, count, _ =>
        {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            history = 0.47 * history + (int)(seed & 0x3fff) - 8192;
            return history;
        });
    }
}
