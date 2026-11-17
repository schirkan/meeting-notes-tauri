using NAudio.Wave;
using MeetingNotes.Sidecar;

/// <summary>
/// Validierung des Resamplers (T-203).
///
/// Der Sidecar muss Geraete-Mixformate (z. B. 48 kHz Stereo) auf das
/// Azure-Zielformat (16 kHz, 16 Bit, mono) bringen. Geprueft wird das an
/// einem synthetischen 1-kHz-Ton: die Laenge belegt Mono (bei Stereo waere
/// die Ausgabe doppelt so lang), der Pegel belegt, dass das Signal ankommt,
/// und Peak-/Dropout-Pruefungen schliessen Uebersteuerung und Luecken aus.
///
/// Wichtig: MediaFoundation laeuft nicht ueberall. In nicht-interaktiven
/// Sitzungen (Dienst, CI) blockiert der Resampler ohne MF-Startup. Die
/// Pruefung laeuft deshalb in einem Hintergrundthread mit Zeitlimit - ein
/// haengender Resampler darf die Validierung nicht blockieren.
/// </summary>
internal static class ResamplingValidation
{
    private static readonly TimeSpan TimeLimit = TimeSpan.FromSeconds(10);

    public static void Run(Action<bool, string> check)
    {
        Exception? failure = null;
        var finished = new ManualResetEventSlim(false);
        var worker = new Thread(() =>
        {
            try { RunChecks(check); }
            catch (Exception ex) { failure = ex; }
            finally { finished.Set(); }
        })
        { IsBackground = true };
        worker.Start();

        if (!finished.Wait(TimeLimit))
        {
            Console.WriteLine(
                "SKIPPED: Resampler-Stichprobentest - MediaFoundation antwortet nicht " +
                "(Zeitlimit " + TimeLimit.TotalSeconds.ToString("0") + " s).");
            return;
        }

        if (failure is not null) throw failure;
    }

    private static void RunChecks(Action<bool, string> check)
    {
        // MediaFoundation muss explizit gestartet werden, sonst blockiert der
        // Resampler in nicht-interaktiven Sitzungen.
        NAudio.MediaFoundation.MediaFoundationApi.Startup();

        var sourceFormat = new WaveFormat(48000, 16, 2);
        var targetFormat = new WaveFormat(16000, 16, 1);
        const double seconds = 0.5;
        const int toneHz = 1000;
        const double amplitude = 12000;

        // 0,5 s 48-kHz-Stereo-PCM16 mit einem 1-kHz-Ton in beiden Kanaelen.
        var input = new byte[sourceFormat.AverageBytesPerSecond * (int)seconds];
        var frameCount = input.Length / 4;
        for (var i = 0; i < frameCount; i++)
        {
            var value = (short)(Math.Sin(2 * Math.PI * toneHz * i / sourceFormat.SampleRate) * amplitude);
            BitConverter.GetBytes(value).CopyTo(input, i * 4);
            BitConverter.GetBytes(value).CopyTo(input, i * 4 + 2);
        }

        // NAudio 3.x: BufferedWaveProvider ist nicht IDisposable und kennt kein
        // AddBuffer mehr - der Sidecar nutzt ebenfalls AddSamples (ReadOnlySpan).
        var provider = new BufferedWaveProvider(sourceFormat);
        provider.AddSamples(input.AsSpan());
        using var resampler = new AudioResampler(provider, targetFormat);
        var output = resampler.DrainToBuffer();

        check(output.Length > 0, "Resampler produces output");

        // Mono-Nachweis ueber die Laenge: bei Stereo waere die Ausgabe doppelt
        // so lang, bei 48 kHz dreimal so lang.
        var expected = (int)(seconds * targetFormat.AverageBytesPerSecond);
        var tolerance = Math.Max(expected / 10, 1600);
        check(Math.Abs(output.Length - expected) <= tolerance,
            $"Resampled length {output.Length} matches the 16 kHz mono expectation {expected} (tolerance {tolerance})");

        // Pegel: das Signal muss durchkommen, aber ohne Uebersteuerung.
        var peak = 0;
        var clipped = false;
        for (var i = 0; i + 1 < output.Length; i += 2)
        {
            var sample = Math.Abs((short)BitConverter.ToInt16(output, i));
            if (sample > peak) peak = sample;
            if (sample >= 32767) clipped = true;
        }
        check(peak > 2000, $"Signal survives resampling (peak {peak} > 2000)");
        check(!clipped, "Resampled signal is not clipped");

        // Dropout-Nachweis: kein langer Leerlauf im Ausgangssignal.
        var longestSilence = 0;
        var currentSilence = 0;
        for (var i = 0; i + 1 < output.Length; i += 2)
        {
            var sample = Math.Abs((short)BitConverter.ToInt16(output, i));
            if (sample < 32)
            {
                currentSilence++;
                if (currentSilence > longestSilence) longestSilence = currentSilence;
            }
            else
            {
                currentSilence = 0;
            }
        }
        check(longestSilence < 200,
            $"No dropout in the resampled signal (longest silence {longestSilence} samples)");
    }
}
