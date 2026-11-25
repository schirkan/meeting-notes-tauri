# T-520: MAI-Transcribe-2-Streaming als optionales Feature

## Kontext
Status: teils umgesetzt (2 Punkte offen)
Reifegrad: Opt-in Preview
Abhaengigkeiten: [T-522: Machbarkeit und Freigabe](./T-522-mai-transcribe-machbarkeit-kosten-abnahme.md), [T-521: Audio und Sidecar](./T-521-mai-transcribe-mehrkanal-sidecar.md), [T-103: Konfiguration](./T-103-konfiguration-azure-und-user-settings.md), [T-403: Settings](./T-403-settings-dialog-mit-verbindung-testen-button.md), [T-511: Quellen](./T-511-transkriptions-quellen-auswaehlen.md)

## Ziel und Nicht-Ziele

Kosten je realer Meetingstunde senken, ohne Mic- und Speaker-Transkript
zusammenzumischen. Mit beiden Quellen laeuft genau **eine** Azure-Transkriptionssitzung
mit zwei getrennten Kanaelen; mit einer Quelle genau eine Mono-Sitzung. Die
App-API (Tauri-Aufrufe, Transcript-Events, Quellen und Markdown) soll erhalten
bleiben. Planungsvorschlag fuer den Cloud-Pfad: die bestehende Azure Speech SDK
Integration weiterverwenden. Das ist nicht die separate `/mai/v1/realtime`-API;
diese akzeptiert laut Referenz nur Mono. Wenn diese URL zwingend ist, ist das
Mehrkanalziel auf dem dokumentierten Stand nicht erfuellbar (T-522).

Keine erzwungene Kontomigration, kein Standardwechsel in der Preview, kein
automatischer Anbieterwechsel, kein Downmix von Mic und Speaker, kein neuer
WebSocket-Client. Eine unerwartet teurere zweite Cloud-Sitzung ist kein Fallback.

## Verhalten und Konfiguration

- Unter **Speech recognition** zwischen **Azure Speech (standard)** und **MAI Transcribe (Preview)**
  waehlen. Additives Feld: `azure.model` (`standard` oder
  `mai-transcribe-2-streaming`). Fehlendes Feld bleibt Standard; unbekannten
  Wert validieren und nicht still als Standard ausfuehren. Azure-Einstellungen
  als bestehender Draft; **Test connection** prueft diesen, nur **Save** persistiert.
  Ein Modellwechsel gilt ab dem naechsten Start und veraendert keine laufende Sitzung.
- Bestehende Azure-Felder und Secrets beim Modellwechsel beibehalten. MAI nutzt
  die regionale SDK-Initialisierung mit Region und Key; nur Standard verwendet
  den expliziten Endpunkt. Das UI zeigt, welche Felder fuer MAI gelten. Fehlende
  oder falsche Region/Ressource/Key bzw. eine nicht verfuegbare Kombination erzeugt
  einen sichtbaren Fehler, auch bei Auto-Start, nie einen stillen Tarifwechsel.
- Mic, Speaker und **Mix** bleiben bedienbar; Mix ist eine Ansicht ueber beide
  Quellen, kein Azure-Mono-Mix.
- `Channel` bezeichnet eine Quelle, keinen Sprecher innerhalb dieser Quelle.
  Die gemeinsame Einstellung **Speaker recognition** gilt fuer beide Quellen.
  Im Standard-Stereo gilt sie fuer den gesamten Stream. MAI nutzt nach einem
  fehlgeschlagenen Praxistest keine Sprechererkennung; Aufnahme und Diagnose
  verwenden den `SpeechRecognizer`. Die gespeicherte Standard-Praeferenz bleibt
  erhalten. MAI-Stereo ist ebenfalls nach erneut beobachtetem Fehlschlag deaktiviert. Auto-Spracherkennung und erkannte Sprachlabels
  werden getrennt abgenommen (T-522).
- Bestehende Sitzungsausgabe, Export, Auto-Start/Stop und Tray-Quit bleiben erhalten.
  Bei einer endenden Cloud-Sitzung keine erfundene Sprecherkontinuitaet und
  kein erfolgreicher Resume-Status ohne aktive Sitzung. Verhalten siehe T-521.
- Vor Freigabe englische README/Beispielconfig und Fehlertexte aktualisieren:
  passende Region und Ressource, Preview ohne SLA, Diagnose, Einschraenkungen,
  Rueckkehr zu Standard. Alte Configs muessen weiterhin ohne Anpassung starten.

## Implementierter Teilstand: Modell- und Audioauswahl

Die Auswahl gilt fuer den naechsten manuellen oder automatischen Start. MAI
nutzt `FromSubscription(key, region)`, das explizite SDK-Modell und dessen
Spracherkennung. Die Primaersprache bleibt als Standard-Einstellung erhalten.
MAI verwendet Mono pro aktiver Quelle; eine gespeicherte Stereo-Praeferenz
wird erst bei Rueckkehr zu Standard wieder wirksam. Kanalzuordnung und Lifecycle
sind in [T-521](./T-521-mai-transcribe-mehrkanal-sidecar.md) beschrieben.

**Test connection** prueft fuer MAI die regionale Speech/WSS-Verbindung mit
Stille im gewaehlen Format, nicht den Standard-HTTPS-Endpunkt. Erkennung,
Kanaltrennung und Kosten sind damit nicht abgenommen.

## Done When
- [x] Modellauswahl, Draft-Diagnose und Rueckkehr zu Standard sind ohne Migration alter Configs implementiert. Beleg: Konfigurations-Unit-Tests in `tests/config-utils.test.mjs`, Settings-/Diagnose-Regression in `tests/startup-ui.test.mjs` (Playwright Chromium mit IPC-Mock) und lokaler SDK-Konfigurationstest in `sidecar/Validation/DiarizationValidation.cs` ohne Azure-Verbindung. Rust-Tests waren durch einen verweigerten MSBuild-Taskhost beim Sidecar-Publish blockiert.
- [ ] UI, IPC und Export bewahren getrennte Quellen; Sprachgrenzen sind sichtbar dokumentiert. - **offen**: Sprache und Quellenlabels bei einer Live-Aufnahme mit MAI-Mono muessen noch abgenommen werden.
- [ ] Preview ist nur nach Kosten-, Qualitaets-, Proxy- und Portable-Freigabe verfuegbar. - **offen**: Freigabekriterien und Messung siehe T-522.
