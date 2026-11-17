using System;
using System.Diagnostics;
using System.Threading.Tasks;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace MeetingNotes.Sidecar;

/// <summary>
/// Eine Aufnahmequelle (Mikrofon oder Speaker-Loopback) auf Basis von NAudio 3.x
/// <see cref="WasapiRecorder"/> (T-509). Ersetzt die als obsolet markierten
/// Klassen <c>WasapiCapture</c> und <c>WasapiLoopbackCapture</c>.
///
/// <para><b>Engine-Modus:</b> Die WASAPI-Engine konvertiert im Shared Mode selbst
/// auf das Zielformat (16 kHz / 16-bit / mono). Die Frames kommen dann ohne
/// Zwischenpuffer und ohne Resampler an.</para>
///
/// <para><b>Resampler-Modus:</b> Kann die Engine nicht auf 16-Bit-PCM konvertieren
/// (typisch bei einem Float-Mic, dessen Mixformat die Engine nicht auf 16-Bit-PCM
/// abbildet), liefert der Recorder das Geraete-Mixformat. Ein
/// <see cref="AudioResampler"/> (MediaFoundation) wandelt dann wie bisher auf das
/// Zielformat um. Das entspricht der bisherigen Aufnahmekette.</para>
///
/// <para>Die Quelle startet im Engine-Modus und faellt in zwei Faellen auf den
/// Resampler zurueck: wenn die Initialisierung scheitert, oder wenn die
/// Laufzeitmessung zeigt, dass die Engine ein anderes Format liefert als
/// angefordert. Welcher Weg aktiv ist, steht nach dem Start in
/// <see cref="ModeLabel"/>.</para>
/// </summary>
internal sealed class AudioRecorderSource : IDisposable
{
    /// <summary>Fensterlaenge der Format-Ueberwachung.</summary>
    private static readonly TimeSpan FormatWatchWindow = TimeSpan.FromSeconds(1);

    /// <summary>Toleranz, in der die Byte-Rate vom Zielformat abweichen darf.</summary>
    private const double RateTolerance = 0.5;

    private readonly MMDevice _device;
    private readonly bool _loopback;
    private readonly WaveFormat _targetFormat;
    private readonly Action<byte[], long, int> _onFrame;
    private readonly string _label;

    private readonly object _verifyLock = new();
    private WasapiRecorder _recorder;
    private BufferedWaveProvider? _mixBuffer;
    private AudioResampler? _resampler;
    private bool _engineMode;
    private bool _disposed;
    private bool _fallbackTriggered;

    private long _bytesInWindow;
    private double _windowStartSeconds;
    private bool _rateMismatchReported;

    private AudioRecorderSource(
        MMDevice device,
        bool loopback,
        WaveFormat targetFormat,
        string label,
        Action<byte[], long, int> onFrame,
        WasapiRecorder recorder)
    {
        _device = device;
        _loopback = loopback;
        _targetFormat = targetFormat;
        _label = label;
        _onFrame = onFrame;
        _recorder = recorder;
        _engineMode = true;
    }

    /// <summary>"engine" oder "resampler" - welcher Konvertierungsweg aktiv ist.</summary>
    public string ModeLabel => _engineMode ? "engine" : "resampler";

    /// <summary>Format, das der Recorder liefert.</summary>
    public WaveFormat Format => _recorder.WaveFormat;

    /// <summary>Effektive Latenz des Aufnahmestreams in Millisekunden.</summary>
    public int LatencyMilliseconds => _recorder.LatencyMilliseconds;

    /// <summary>Durchschnittliche Latenz des Aufnahmestreams.</summary>
    public TimeSpan AverageLatency => _recorder.AverageLatency;

    /// <summary>Grund fuer den Rueckfall in den Resampler-Modus (null = kein Rueckfall).</summary>
    public Exception? FallbackReason { get; private set; }

    /// <summary>
    /// Legt die Quelle an. Der Recorder wird gebaut, aber noch nicht gestartet;
    /// erst <see cref="Start"/> entscheidet, ob der Engine- oder der
    /// Resampler-Modus greift.
    /// </summary>
    public static AudioRecorderSource Create(
        MMDevice device,
        bool loopback,
        WaveFormat targetFormat,
        string label,
        Action<byte[], long, int> onFrame)
    {
        var recorder = BuildRecorder(device, loopback, targetFormat);
        var source = new AudioRecorderSource(device, loopback, targetFormat, label, onFrame, recorder);
        source.Attach(recorder);
        return source;
    }

    /// <summary>
    /// Startet die Aufnahme. Scheitert die Initialisierung im Engine-Modus,
    /// faellt die Quelle auf den MediaFoundation-Resampler zurueck.
    /// </summary>
    public void Start()
    {
        if (!_engineMode)
        {
            _recorder.StartRecording();
            return;
        }

        try
        {
            _recorder.StartRecording();
            _windowStartSeconds = NowSeconds();
            Logger.Info(
                "format",
                "recorder_mode",
                $"Quelle '{_label}': Engine-Modus, Zielformat {_targetFormat}, " +
                $"Latenz {_recorder.LatencyMilliseconds} ms.");
            return;
        }
        catch (Exception ex)
        {
            FallbackReason = ex;
        }

        SwitchToFallback("Die WASAPI-Engine konnte das Zielformat nicht initialisieren.");
    }

    /// <summary>Beendet die Aufnahme.</summary>
    public void Stop()
    {
        try
        {
            _recorder.StopRecording();
        }
        catch (Exception)
        {
            // Stop ist bestmoeglich; ein Fehler darf den Shutdown nicht blockieren.
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        try
        {
            _recorder.Dispose();
        }
        catch (Exception)
        {
            // Dispose ist bestmoeglich.
        }
        _resampler?.Dispose();
    }

    private void SwitchToFallback(string reason)
    {
        Logger.Warn(
            "format",
            "engine_conversion_unavailable",
            $"Quelle '{_label}': {reason} Rueckfall auf den MediaFoundation-Resampler.");
        try
        {
            _recorder.Dispose();
        }
        catch (Exception)
        {
            // Der alte Recorder wird ohnehin ersetzt.
        }

        // Ohne angefordertes Format liefert der Recorder das Geraete-Mixformat.
        _recorder = BuildRecorder(_device, _loopback, requestedFormat: null);
        _mixBuffer = new BufferedWaveProvider(_recorder.WaveFormat)
        {
            DiscardOnBufferOverflow = true,
            ReadFully = false
        };
        _resampler = new AudioResampler(_mixBuffer, _targetFormat);
        _engineMode = false;
        Attach(_recorder);
        _recorder.StartRecording();
        Logger.Info(
            "format",
            "recorder_mode",
            $"Quelle '{_label}': Resampler-Modus, Quellformat {_recorder.WaveFormat} -> {_targetFormat}.");
    }

    private void Attach(WasapiRecorder recorder)
    {
        recorder.DataAvailable += OnDataAvailable;
        recorder.RecordingStopped += OnRecordingStopped;
    }

    private void OnDataAvailable(
        ReadOnlySpan<byte> buffer,
        AudioClientBufferFlags flags,
        long devicePosition,
        long qpcPosition)
    {
        try
        {
            // T-502: Zeitstempel fuer die Latenzmessung. capturedAtTicks markiert
            // den Moment, in dem der Buffer im Sidecar ankommt; captureLatencyMs ist
            // das Alter des WASAPI-Puffers (von NAudio berechnet, also inklusive
            // Geraete-Latenz) und damit die erste Stufe der Kette.
            var capturedAtTicks = Stopwatch.GetTimestamp();
            var captureLatencyMs = _recorder.LatencyMilliseconds;

            if (_mixBuffer is not null && _resampler is not null)
            {
                // Resampler-Modus: Geraete-Mixformat -> Zielformat.
                _mixBuffer.AddSamples(buffer);
                var pcm = _resampler.DrainToBuffer();
                if (pcm.Length == 0) return;
                _onFrame(pcm, capturedAtTicks, captureLatencyMs);
                return;
            }

            // Engine-Modus: das Zielformat soll direkt aus der Engine kommen.
            // Der Span gilt nur fuer die Dauer des Callbacks, deshalb kopieren.
            _onFrame(buffer.ToArray(), capturedAtTicks, captureLatencyMs);
            WatchEngineRate(buffer.Length);
        }
        catch (Exception ex)
        {
            Logger.Error("SIDECAR_UNAVAILABLE", $"Aufnahmefehler ({_label}): {ex.Message}");
        }
    }

    /// <summary>
    /// Prueft, ob die Engine wirklich das angeforderte Format liefert. Die
    /// Byte-Rate muss zum Zielformat passen; liefert die Engine ein anderes
    /// Format (z. B. Float statt 16-Bit-PCM), wird auf den Resampler
    /// zurueckgeschaltet.
    /// </summary>
    private void WatchEngineRate(int bytes)
    {
        bool mismatch = false;
        lock (_verifyLock)
        {
            if (_fallbackTriggered) return;
            _bytesInWindow += bytes;
            var now = NowSeconds();
            var elapsed = now - _windowStartSeconds;
            if (elapsed < FormatWatchWindow.TotalSeconds) return;

            // Keine Daten im Fenster: die Quelle liefert gerade nichts (z. B.
            // ein Loopback-Geraet im Leerlauf). Daraus laesst sich kein
            // Format ableiten - also nichts bewerten.
            if (_bytesInWindow == 0)
            {
                _windowStartSeconds = now;
                return;
            }

            var actualRate = _bytesInWindow / elapsed;
            var expectedRate = _targetFormat.AverageBytesPerSecond;
            _bytesInWindow = 0;
            _windowStartSeconds = now;

            if (actualRate >= expectedRate * (1 - RateTolerance) &&
                actualRate <= expectedRate * (1 + RateTolerance))
            {
                return;
            }
            mismatch = true;
            _fallbackTriggered = true;
            if (!_rateMismatchReported)
            {
                _rateMismatchReported = true;
                Logger.Warn(
                    "format",
                    "engine_format_mismatch",
                    $"Quelle '{_label}': Die Engine liefert {actualRate:F0} Byte/s statt der " +
                    $"erwarteten {expectedRate:F0} Byte/s fuer {_targetFormat}. " +
                    "Es wird auf den MediaFoundation-Resampler zurueckgeschaltet.");
            }
        }

        if (!mismatch) return;
        // Nicht im Capture-Thread umschalten: Dispose wartet auf das Ende
        // dieses Threads und wuerde sonst selbst blockieren.
        _ = Task.Run(SwitchToFallbackFromWatch);
    }

    private void SwitchToFallbackFromWatch()
    {
        try
        {
            SwitchToFallback("Die Engine lieferte ein anderes Format als angefordert.");
        }
        catch (Exception ex)
        {
            Logger.Error("SIDECAR_UNAVAILABLE", $"Rueckfall auf den Resampler fehlgeschlagen: {ex.Message}");
        }
    }

    private void OnRecordingStopped(object? sender, StoppedEventArgs e)
    {
        if (e.Exception is null) return;
        Logger.Error(
            "SIDECAR_UNAVAILABLE",
            $"Aufnahme ({_label}) wurde abgebrochen: {e.Exception.Message}");
    }

    private static double NowSeconds() => Stopwatch.GetTimestamp() / (double)Stopwatch.Frequency;

    private static WasapiRecorder BuildRecorder(
        MMDevice device,
        bool loopback,
        WaveFormat? requestedFormat)
    {
        // Kein WithMmcssThreadPriority: der Capture-Thread schiebt die Frames
        // blockierend in den Azure-PushStream. Eine Audio-Scheduling-Prioritaet
        // wuerde waehrend dieser Netzwerkwartezeit einen MMCSS-Reservierungs-
        // Platz halten. Die bisherige WasapiCapture-Klasse setzte ebenfalls kein
        // MMCSS - die Aufnahme bleibt damit in der Scheduler-Klasse unveraendert.
        var builder = new WasapiRecorderBuilder()
            .WithDevice(device)
            .WithSharedMode()
            .WithEventSync();
        if (requestedFormat is not null)
        {
            builder = builder.WithFormat(requestedFormat);
        }
        if (loopback)
        {
            // Systemweiter Loopback auf dem Render-Endpoint des Ausgabegeraets.
            // Kein WithProcessLoopback: das erfasst nur den eigenen Prozess und
            // wuerde fremde Audioquellen verlieren.
            builder = builder.WithLoopbackCapture();
        }
        return builder.Build();
    }
}
