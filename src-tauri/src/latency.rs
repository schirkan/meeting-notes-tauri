//! Latenz-Messung (T-502).
//!
//! Die Kette vom Mikrofon bis zum Transkript im Fenster besteht aus
//! mehreren Stufen:
//!
//! 1. WASAPI-Puffer -> Callback im Sidecar  (im Sidecar gemessen)
//! 2. Callback -> Azure-PushStream          (im Sidecar gemessen)
//! 3. Azure-Roundtrip -> Sidecar-Event      (im Sidecar gemessen)
//! 4. Sidecar-Event -> JSON-Lines -> Rust    (hier gemessen)
//! 5. Rust -> Tauri-Event -> Renderer        (hier gemessen, Paint nicht)
//!
//! Der Sidecar liefert die Stufen 1-3 als `latency`-Objekt im
//! Transcript-Event. Dieser Teil ergaenzt Stufe 4 und die Summe und
//! schreibt - wenn `MEETING_NOTES_LATENCY_LOG` gesetzt ist - eine
//! Messzeile pro Event als NDJSON.

use std::fs::OpenOptions;
use std::io::Write;
use std::time::{SystemTime, UNIX_EPOCH};

/// Umgebungsvariable, in die der Pfad der Messdatei zeigt.
pub const LOG_ENV: &str = "MEETING_NOTES_LATENCY_LOG";

/// Aktuelle Unixzeit in Millisekunden.
pub fn now_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Zielpfad der Messdatei, falls eine Messung laeuft.
pub fn log_path() -> Option<String> {
    std::env::var(LOG_ENV).ok().filter(|p| !p.trim().is_empty())
}

fn number(value: Option<&serde_json::Value>) -> f64 {
    value.and_then(|v| v.as_f64()).unwrap_or(0.0)
}

/// Rechnet das `latency`-Objekt des Sidecars um.
///
/// Der Sidecar liefert `emittedAtUnixMs` (Unix-ms) und die Stufen 1-3 in
/// Millisekunden. Daraus werden die Pipe-Stufe und die Gesamtlatenz bis
/// zum Tauri-Event berechnet. Fehlt das `latency`-Objekt (aelteres
/// Sidecar), bleibt das Payload unveraendert.
pub fn enrich(payload: &serde_json::Value) -> serde_json::Value {
    let mut payload = payload.clone();
    let latency = match payload.get("latency").and_then(|v| v.as_object()) {
        Some(l) => l.clone(),
        None => return payload,
    };

    let emitted = latency
        .get("emittedAtUnixMs")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let pipe_to_event_ms = if emitted > 0 {
        (now_unix_ms() - emitted).max(0)
    } else {
        0
    };

    let sidecar_total = number(latency.get("captureLatencyMs"))
        + number(latency.get("sidecarToPushMs"))
        + number(latency.get("azureToEventMs"));
    let total_ms = sidecar_total + pipe_to_event_ms as f64;

    let mut updated = latency;
    updated.insert(
        "pipeToEventMs".to_string(),
        serde_json::json!(pipe_to_event_ms),
    );
    updated.insert("totalMs".to_string(), serde_json::json!(total_ms));
    if let Some(map) = payload.as_object_mut() {
        map.insert("latency".to_string(), serde_json::Value::Object(updated));
    }
    payload
}

/// Schreibt eine kompakte Messzeile (NDJSON) in die Messdatei.
///
/// Ohne `MEETING_NOTES_LATENCY_LOG` passiert nichts - die Messung ist
/// damit im Normalbetrieb ohne Zusatzkosten.
pub fn write_sample(payload: &serde_json::Value) {
    let path = match log_path() {
        Some(p) => p,
        None => return,
    };
    let latency = payload.get("latency").cloned().unwrap_or(serde_json::Value::Null);
    let sample = serde_json::json!({
        "tsUnixMs": now_unix_ms(),
        "source": payload.get("source").cloned().unwrap_or(serde_json::Value::Null),
        "state": payload.get("state").cloned().unwrap_or(serde_json::Value::Null),
        "latency": latency,
    });
    let line = match serde_json::to_string(&sample) {
        Ok(l) => l,
        Err(_) => return,
    };
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(file, "{line}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enrich_adds_pipe_stage_and_total() {
        let emitted = now_unix_ms() - 120;
        let payload = serde_json::json!({
            "source": "mic",
            "state": "final",
            "latency": {
                "captureLatencyMs": 10.0,
                "sidecarToPushMs": 2.0,
                "azureToEventMs": 100.0,
                "emittedAtUnixMs": emitted
            }
        });
        let out = enrich(&payload);
        let latency = out.get("latency").expect("latency");
        let pipe = latency
            .get("pipeToEventMs")
            .and_then(|v| v.as_i64())
            .expect("pipeToEventMs");
        // Die Pipe-Stufe misst die Zeit zwischen Sidecar-Event und Rust.
        assert!(
            (100..=250).contains(&pipe),
            "Pipe-Latenz ausserhalb des plausiblen Bereichs: {pipe}"
        );
        let total = latency
            .get("totalMs")
            .and_then(|v| v.as_f64())
            .expect("totalMs");
        assert!(
            total >= 112.0 && total <= 400.0,
            "Gesamtlatenz ausserhalb des plausiblen Bereichs: {total}"
        );
    }

    #[test]
    fn enrich_without_latency_leaves_payload_untouched() {
        let payload = serde_json::json!({ "source": "mic", "text": "hallo" });
        let out = enrich(&payload);
        assert!(out.get("latency").is_none());
        assert_eq!(out.get("text").and_then(|v| v.as_str()), Some("hallo"));
    }
}
