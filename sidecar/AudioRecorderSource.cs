using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
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
/// <para>Die Quelle startet im Engine-Modus und faellt auf den Resampler
/// zurueck, wenn die Initialisierung mit dem Zielformat scheitert.
/// Datenmenge pro Wandzeit ist bei Loopback mit Leerlauf kein Formatnachweis.
/// Welcher Weg aktiv ist, steht nach dem Start in
/// <see cref="ModeLabel"/>.</para>
/// </summary>
internal sealed class AudioRecorderSource : IDisposable
{
    private readonly MMDevice _device;
    private readonly bool _loopback;
    private readonly WaveFormat _targetFormat;
    private readonly Action<byte[], long, int, long?> _onFrame;
    private readonly string _label;
    private readonly bool _includePacketTimestamp;

    private WasapiRecorder _recorder;
    private BufferedWaveProvider? _mixBuffer;
    private AudioResampler? _resampler;
    private bool _engineMode;
    private bool _disposed;
    private bool _resamplerDiscontinuity;
    private long? _lastAudioActivity;
    internal event Action<Exception>? CaptureFailed;

    private AudioRecorderSource(
        MMDevice device,
        bool loopback,
        WaveFormat targetFormat,
        string label,
        bool includePacketTimestamp,
        Action<byte[], long, int, long?> onFrame,
        WasapiRecorder recorder)
    {
        _device = device;
        _loopback = loopback;
        _targetFormat = targetFormat;
        _label = label;
        _onFrame = onFrame;
        _includePacketTimestamp = includePacketTimestamp;
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
        bool includePacketTimestamp,
        Action<byte[], long, int, long?> onFrame)
    {
        var recorder = BuildRecorder(device, loopback, targetFormat);
        var source = new AudioRecorderSource(device, loopback, targetFormat, label, includePacketTimestamp, onFrame, recorder);
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
            Logger.Info(
                "format",
                "recorder_mode",
                $"Source '{_label}': engine mode, target format {_targetFormat}, " +
                $"Latenz {_recorder.LatencyMilliseconds} ms.");
            return;
        }
        catch (Exception ex)
        {
            FallbackReason = ex;
        }

        SwitchToFallback("The WASAPI engine could not initialize the target format.");
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
            $"Source '{_label}': {reason} falling back to the MediaFoundation resampler.");
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
        // T-203: MediaFoundation explizit starten, bevor der Resampler
        // erzeugt wird. Ohne MF-Startup blockiert die Transform-Erzeugung in
        // nicht-interaktiven Sitzungen (Dienst, CI). Der Aufruf steht
        // bewusst nur hier: der Engine-Modus (Normalfall) fasst
        // MediaFoundation gar nicht an.
        NAudio.MediaFoundation.MediaFoundationApi.Startup();
        _resampler = new AudioResampler(_mixBuffer, _targetFormat);
        _engineMode = false;
        Attach(_recorder);
        _recorder.StartRecording();
        Logger.Info(
            "format",
            "recorder_mode",
            $"Source '{_label}': resampler mode, source format {_recorder.WaveFormat} -> {_targetFormat}.");
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

            // WASAPI packet start in the shared QPC clock (100 ns units), not
            // callback arrival time. Invalid timestamps are not passed to audio processing as QPC anchors.
            const AudioClientBufferFlags badTiming = AudioClientBufferFlags.DataDiscontinuity | AudioClientBufferFlags.TimestampError;
            long? packetTimestamp = _includePacketTimestamp && qpcPosition > 0 && (flags & badTiming) == 0 ? qpcPosition : null;

            if (_mixBuffer is not null && _resampler is not null)
            {
                // Resampler-Modus: Geraete-Mixformat -> Zielformat.
                if (_includePacketTimestamp) _resamplerDiscontinuity |= packetTimestamp is null;
                _mixBuffer.AddSamples(buffer);
                var pcm = _resampler.DrainToBuffer();
                if (pcm.Length == 0) return;
                if (_includePacketTimestamp)
                {
                    var mixFormat = _mixBuffer.WaveFormat;
                    var inputSeconds = (double)(buffer.Length / mixFormat.BlockAlign) / mixFormat.SampleRate;
                    var outputSeconds = (double)(pcm.Length / _targetFormat.BlockAlign) / _targetFormat.SampleRate;
                    // A steady conversion delay can be found by correlation. When
                    // the resampler batches audio, do not assign an unreliable clock.
                    if (_resamplerDiscontinuity || Math.Abs(inputSeconds - outputSeconds) > 0.005)
                        packetTimestamp = null;
                    _resamplerDiscontinuity = false;
                }
                ReportAudioActivity(pcm, capturedAtTicks);
                _onFrame(pcm, capturedAtTicks, captureLatencyMs, packetTimestamp);
                return;
            }

            // Engine-Modus: das Zielformat soll direkt aus der Engine kommen.
            // Der Span gilt nur fuer die Dauer des Callbacks, deshalb kopieren.
            if ((flags & AudioClientBufferFlags.Silent) == 0) ReportAudioActivity(buffer, capturedAtTicks);
            _onFrame(buffer.ToArray(), capturedAtTicks, captureLatencyMs, packetTimestamp);
        }
        catch (Exception ex)
        {
            if (CaptureFailed is { } onFailure) onFailure(ex);
            else Logger.Error("SIDECAR_UNAVAILABLE", $"Recording error ({_label}): {ex.Message}");
        }
    }

    private void ReportAudioActivity(ReadOnlySpan<byte> pcm, long capturedAtTicks)
    {
        if (_targetFormat.BitsPerSample != 16 || _targetFormat.Encoding != WaveFormatEncoding.Pcm
            || (_lastAudioActivity is long last && capturedAtTicks - last < Stopwatch.Frequency)) return;
        // A floor of roughly -50 dBFS ignores very low background noise.
        foreach (var sample in MemoryMarshal.Cast<byte, short>(pcm))
        {
            if (sample is > -104 and < 104) continue;
            _lastAudioActivity = capturedAtTicks;
            Logger.Event("audio_activity", true);
            break;
        }
    }

    private void OnRecordingStopped(object? sender, StoppedEventArgs e)
    {
        if (e.Exception is null) return;
        if (CaptureFailed is { } onFailure) onFailure(e.Exception);
        else Logger.Error("SIDECAR_UNAVAILABLE", $"The recording ({_label}) was aborted: {e.Exception.Message}");
    }

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
