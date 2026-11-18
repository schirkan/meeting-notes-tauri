/**
 * Gemeinsame Klassifikation der Spec-Dateien.
 *
 * Der Generator (update-spec-overview.mjs) und der Konsistenz-Checker
 * (check-spec-consistency.mjs) muessen dieselbe Liste kennen - sonst
 * widersprechen sich die Zahlen in SPEC.md und der Checker meldet zu
 * unrecht einen Drift. Die Liste wurde deshalb doppelt gepflegt; jetzt
 * steht sie an genau einer Stelle.
 *
 * Aufteilung der offenen Punkte:
 *   - "braucht deinen Rechner": die Messung ist auf einem echten Rechner
 *     nicht ausfuehrbar (Hardware, Azure-Credentials, Clean Machine).
 *   - "bewusste Entscheidung": nicht umgesetzt, mit Begruendung.
 */

// Specs, deren offene Punkte eine Messung auf einem echten Rechner brauchen.
export const NEEDS_TARGET_MACHINE = new Set([
  'T-205-continuous-lid-und-diarization-in-c-sharp.md',
  'T-500-qualitaetssicherung-und-akzeptanztests.md',
  'T-502-latency-messung.md',
  'T-504-portable-build.md',
  'T-509-audio-capture-auf-wasapirecorderbuilder-umstellen.md',
  'T-510-clean-machine-deployment-windows-11.md'
])