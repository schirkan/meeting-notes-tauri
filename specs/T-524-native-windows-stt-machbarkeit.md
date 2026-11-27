# T-524: Windows-Spracherkennung ohne Azure-Zugangsdaten – API-Auswahl und Abnahme

## Kontext
Status: teils umgesetzt (3 Punkte offen; nur Recherche abgeschlossen)
Datum: 25.11.2026
Abhaengigkeiten: [T-523: Provider-Vertrag](./T-523-native-windows-stt-provider.md), [T-504: Portable](./T-504-portable-build.md), [T-512: .NET-Sidecar](./T-512-sidecar-targetframeworks-und-single-file.md)

## Bewertung

**Machbar als zu pruefendes Opt-in, nicht als Azure-Ersatz mit Funktionsparitaet.**
Der Produktgewinn ist Transkription ohne eigenes Azure-Konto, Speech Key
oder separate Zugangsdaten in Meeting Notes. Der Windows-Onlinedienst ist
zulaessig, wenn Netzwerkbedarf und Audioverarbeitung klar angezeigt werden.
Entscheidend sind Dauerbetrieb, Eingabe unserer Streams, Quellenlabels,
Qualitaet und Portable-Eignung; Offline ist ein Bonus.

| Kandidat | Befund | Entscheidung |
|---|---|---|
| `System.Speech.Recognition` / Windows SAPI, C# | In-Process-Engine, `InstalledRecognizers`, `DictationGrammar`, `SetInputToAudioStream(Stream, format)` und asynchroner Mehrfachmodus. Damit ist das Einspeisen unseres PCM API-seitig plausibel. Installierte x64-Diktat-Recognizer, Live-Stream-Verhalten, Parallelitaet und getrimmtes Portable sind nicht nachgewiesen. Ein Windows-Sprachpaket oder Voice Access ist kein Beweis fuer einen passenden SAPI-Recognizer. | **Erster Spike** fuer das heutige entpackte Windows-x64-Produkt. Nicht shippen, wenn der Zielrechner keine brauchbare Engine hat oder das Transkript nicht meetingtauglich ist. |
| `Microsoft.Windows.AI.Speech` / Windows App SDK | Experimentelle API; die Laborintegration erforderte MSIX-Paketidentitaet und ein bereitgestelltes Modell. | Laborpfad wegen des Bereitstellungsaufwands entfernt. |
| `tauri-plugin-device-ai-apis` / `Windows.Media.SpeechRecognition` | Windows-Backend verwendet `SpeechRecognizer.RecognizeAsync()`; Rust-Streaming-Start/Stop ist auf Windows nicht unterstuetzt. Microsoft verlangt fuer diese WinRT-API Paketidentitaet; die vordefinierte WinRT-Diktatgrammatik benutzt einen Remote-Dienst. Die Online-Verarbeitung ist zulaessig, eigenes Loopback-PCM nimmt das Plugin aber nicht entgegen. TTS im Plugin synthetisiert auf Windows einen Stream, spielt ihn laut README aber nicht ab. | Nicht als Meeting-STT-Abhaengigkeit uebernehmen. Direkte WinRT-Integration allenfalls als Mikrofon-Variante pruefen: ContinuousRecognitionSession, Online-Policy und Paketidentitaet auf Zielrechner nachweisen; kein gleichwertiger Meeting-Modus ohne Loopback. |
| Web Speech API (`SpeechRecognition`) in Edge / WebView2 | Die Webseite uebergibt keinen Azure-Key; Browser/Runtime, Berechtigungen und ggf. ein Onlinedienst bestimmen die Verfuegbarkeit. `start()` nutzt das Mikrofon, `start(audioTrack)` akzeptiert laut Web-API einen lebenden Audio-Track. Kein direkter Eingang fuer die vorhandenen Sidecar-PCM-Frames. | Als separaten, kostenguenstigen Vergleich pruefen, nicht als Windows-Native-API oder nachgewiesenen Ersatz fuer den Meeting-Pfad behandeln. |

## Edge unter Windows: Recherche und Verfuegbarkeitscheck

- Am 25.11.2026 in einem frischen Headless-Profil von Edge Stable
  **157.0.4341.60** auf Windows (Loopback-Origin): `SpeechRecognition` und
  `webkitSpeechRecognition`, `continuous`, `processLocally`, `available()` und
  `install()` vorhanden. `available({ processLocally: true })` meldete fuer
  `de-DE` und `en-US` jeweils `unavailable`. Kein `start()`, Mikrofonzugriff,
  Modelldownload oder Erkennungsdienst-Aufruf; kein Online-Erkennungserfolg
  und keine allgemeine Aussage zur Modellverfuegbarkeit abgeleitet.
- Microsoft beschreibt das lokale Modell in seiner Edge-Doku fuer Canary/Dev
  ab 150.0.4076 mit Flag und Modellbereitstellung. Das ist kein Stable- oder
  WebView2-Freigabebeleg. Online ist zulaessig; verwaltete Edge-Profile koennen
  Spracherkennung per Richtlinie abschalten. Datenverarbeitung und notwendige
  Berechtigungen muessen vor Aktivierung kenntlich sein.
- Edge und das eingebettete **WebView2** von Meeting Notes separat pruefen.
  Ein offener WebView2-Bericht dokumentiert einen `network`-Fehler in Runtime
  153 bei funktionierender Runtime 152 und funktionierendem Edge; das ist ein
  Regressionshinweis, kein Nachweis fuer die aktuelle Runtime. Ein vorhandener
  JS-Konstruktor ist nur ein Verfuegbarkeitsindikator, kein Diensttest.
  Im selben Ticket wurde fuer Teams Desktop mit WebView2 156 der Workaround
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--disable-features=msSpeechRecognitionServiceUseCetoService`
  nach einem vollstaendigen Neustart gemeldet ([Teams-Bericht](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5724#issuecomment-6454841679)).
  Ein anderer Bericht bestaetigt die Option fuer WebView2 153; die Erkennung
  bleibt dabei online. Fuer Meeting Notes nur als diagnosebezogenen A/B-Test
  mit frischem App-/WebView2-Prozess und auf den Testprozess begrenzter
  Umgebung einplanen. Nicht als Produktstandard oder Benutzer-Umgebungsvariable
  setzen: Ein persistenter Wert kann auch andere WebView2-Apps betreffen.
  Erfolgreiche Erkennung und Track-Routing in Meeting Notes bleiben unbewiesen.
- Folgetest ohne Produktintegration: zunaechst ein freigegebener Test-Track in
  Edge Stable, dann derselbe Track in WebView2 der portablen App. Positivtest
  mit unterscheidbarem Track und Mikrofon, damit ein ignoriertes Argument
  nicht als Erfolg gilt. Es folgen zwei unabhaengige Tracks, Unterbrechungen
  nach Stille, Dauerbetrieb, Berechtigungen, Policy/Netzausfall, minimiertes
  Fenster, Stop/Ende und Begrenzung spaeter Events. `continuous` garantiert
  keine ununterbrochene Sitzung. `getDisplayMedia` benoetigt Benutzeraktion
  und Auswahl; angebotenes Systemaudio ist kein transparenter Ersatz fuer
  die bestehende WASAPI-Loopback-Quelle oder den Auto-Start. Eine PCM-Bridge
  vom Sidecar ins WebView waere eine Architekturentscheidung, nicht Teil des
  heutigen Textereignis-/Steuerungs-IPC. Bis dahin hoechstens ein Kandidat fuer
  einen deutlich gekennzeichneten, manuell gestarteten Mikrofonmodus.

Ein lokal bereitgestelltes
Drittmodell (z.B. Whisper) waere eine separate Entscheidung zu Modellen,
Lizenz, Paketgroesse und CPU-Last, kein stiller Fallback und kein Teil dieses
Auftrags. Keine Uebernahme von Windows-Live-Captions-UI als Eingabequelle.

## Windows AI Speech: Historischer Build-Nachweis

Vor der Entfernung wurde das getrennte unsignierte x64-Labor-MSIX mit dem
Windows-SDK-Packager erstellt. Manifest (`systemAIModels`), Tauri-Host,
experimenteller Sidecar und native Speech-DLL wurden im Paket geprueft.
Der daraus extrahierte Sidecar meldete ohne Registrierung erwartungsgemaess
fehlende MSIX-Identitaet (Exit 1); der Standard-Sidecar meldete fehlenden
experimentellen Backend-Build. Das normale Portable-Layout bestand 9 von 9
Deployment-Checks. Paketregistrierung, Modellverfuegbarkeit und Live-Erkennung
wurden nicht getestet.

## Naechster Schritt: Live-Abnahme der experimentellen Modellpfade

T-523 integriert Windows SAPI und die Web Speech API experimentell. Lokaler Sidecar-Nachweis: Zwei parallele `en-GB`-Recognizer erkannten getrennte synthetische Referenzsignale. Der getrimmte x64-Sidecar konnte die Diktatgrammatik fuer `de-DE` und `en-GB`, nicht fuer `en-US`, laden. Diese Tests prueften kein echtes Mikrofon, keinen Live-Loopback und keinen WebView2-Onlinedienst. Der optionale native WebView2-Aufruf zur reinen API-Erkennung konnte in der Testsitzung keinen Debug-Endpunkt bereitstellen; die Verfuegbarkeit im eingebetteten WebView2 bleibt deshalb offen.

1. In einem isolierten Test die 64-Bit-Recognizer und Kulturen inventarisieren.
   Zuerst Referenz-PCM (16 kHz, PCM16, mono) mit `de-DE` und `en-US`
   erkennen; dann begrenzten Stream mit WASAPI-Mic- und Loopback-Zufuhr
   einzeln pruefen. Bei Online-Kandidaten nur explizit freigegebenes
   Testaudio und die benoetigten Windows-Einstellungen verwenden.
2. Zwei Instanzen mit kontrastierenden Referenzsaetzen testen. Kanaltreue,
   gleichzeitiges Sprechen, CPU/RAM, Rueckstau und Pause/Stop/EOF pruefen.
   Fakten je Windows-Build, Architektur, Engine, Sprache und Geraet notieren.
3. Erst danach ueber Preview urteilen. Auf Clean Windows 11 x64 mit WebView2
   dasselbe aus dem entpackten, selbstenthaltenen, getrimmten Zip testen; ohne
   Azure-Konfiguration. Fuer Online-Kandidaten Netz-/Policy-Ausfall und
   Wiederverfuegbarkeit pruefen; fuer lokal beworbene Kandidaten zusaetzlich
   ohne Netzwerk testen. Windows-Komponenten und Modellbereitstellung
   getrennt belegen, verwaltete/gesperrte Rechner beruecksichtigen.

## Done When
- [ ] 64-Bit-Engine fuer Deutsch und Englisch, Mic und Loopback einzeln sowie getrennt bei gleichzeitiger Aktivitaet nachgewiesen. - **offen**: Zielrechner mit passenden Sprachkomponenten und Audio-Endpunkten erforderlich.
- [ ] Mindestens 30 Minuten Referenzgespraech inkl. Ueberlappung und Pause/Resume/Stop/Quit messen; WER, p50/p95 bis Final, CPU, RAM und Verlust erfassen. - **offen**: Messung und Qualitaetsschwelle vor Preview-Freigabe festlegen; keine Azure-Paritaet behaupten.
- [ ] Clean-Machine-Nachweis am getrimmten Portable-ZIP: kein Azure-Konto oder Key, dokumentierte Windows-Komponenten und Online-Anforderungen; fehlende Engine, Netz oder Policy liefert klare Meldung. - **offen**: portable Laufzeit auf einem sauberen Zielrechner inklusive Browser-WebView2-Verhalten pruefen.

## Quellen (25.11.2026)
- Microsoft: [Edge SpeechRecognition](https://learn.microsoft.com/en-us/microsoft-edge/web-ai/speech-recognition-api), [Edge-Richtlinie SpeechRecognitionEnabled](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/speechrecognitionenabled), [Edge vs. WebView2](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/browser-features), [WebView2-Fehlerbericht #5724](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5724).
- MDN: [SpeechRecognition.start(audioTrack)](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/start), [getDisplayMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia).
- Microsoft: [SpeechRecognitionEngine](https://learn.microsoft.com/en-us/dotnet/api/system.speech.recognition.speechrecognitionengine), [Stream-Eingabe](https://learn.microsoft.com/en-us/dotnet/api/system.speech.recognition.speechrecognitionengine.setinputtoaudiostream) und [System.Speech-Paket](https://www.nuget.org/packages/System.Speech/).
- Microsoft: [Windows AI Speech Recognition](https://learn.microsoft.com/en-us/windows/ai/apis/speech-recognition), [AudioConfiguration](https://learn.microsoft.com/en-us/windows/windows-app-sdk/api/winrt/microsoft.windows.ai.speech.audioconfiguration), [Windows-AI-App-Setup](https://learn.microsoft.com/en-us/windows/ai/apis/get-started).
- Microsoft: [WinRT Speech recognition, Paketidentitaet und Remote-Diktat](https://learn.microsoft.com/en-us/windows/apps/develop/input/speech-recognition).
- Hypothesi: [README](https://github.com/hypothesi/tauri-plugin-device-ai-apis), [Windows-Backend (v0.3.0)](https://github.com/hypothesi/tauri-plugin-device-ai-apis/blob/v0.3.0/crates/device-ai/src/windows.rs#L45-L127) und [Streaming-Routing (v0.3.0)](https://github.com/hypothesi/tauri-plugin-device-ai-apis/blob/v0.3.0/crates/device-ai/src/lib.rs#L216-L247).
