# T-206: Azure-Start-Pfad mit Promise-basiertem Lifecycle und Rollback

## Kontext
Status: umgesetzt
Priorität: high
Abhängigkeiten: T-204

## Goal
Robusten Start-/Stop-Pfad für beide Recognizer implementieren. Bei Fehlschlag wird sauber zurückgerollt (`status.running=false`).

## Done When
- [x] `StartAsync()` startet beide Recognizer in definierter Reihenfolge und gibt ein `Task<bool>` zurück. Beleg: StartStreamAsync in AzureSpeechService.cs.
- [x] Bei Fehler in einem Recognizer wird der andere ebenfalls gestoppt und der gesamte Start als fehlgeschlagen gemeldet. Beleg: Rollback beim Startfehler.
- [x] `StopAsync()` stoppt beide Recognizer korrekt (typ-spezifisch) und wartet auf Beendigung. Beleg: StopAsync.
- [x] Bei Azure-Authentifizierungsfehler wird `AZURE_AUTH_FAILED` als Event emittiert. Beleg: AZURE_AUTH_FAILED in AzureSpeechService.cs.
- [x] Bei Recognizer-Startfehler wird `AZURE_RECOGNIZER_FAILED` als Event emittiert. Beleg: AZURE_RECOGNIZER_FAILED in AzureSpeechService.cs.
- [x] `interimResults` aus der Config wird tatsächlich wirksam (`SpeechServiceResponse_InterimResults=true`). Beleg: SpeechServiceResponse_InterimResults in SpeechConfiguration.cs.

## Approach
- C#-Pattern: `TaskCompletionSource<bool>` für jeden Recognizer-Start, mit Timeout (z. B. 10 s).
- Failure-Pfad: bei einem Fehler beide Recognizer disposen, dann Event senden.
- Bestehende Lessons aus `../meeting-notes` Audit (`interimResults`, Promise-basierter Start, Rollback) sind 1:1 anzuwenden.

## Log
- 2026-06-25: Spec angelegt.