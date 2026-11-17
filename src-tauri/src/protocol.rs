//! Protokoll-Versionsabgleich zwischen App und Sidecar (T-201).
//!
//! Der Sidecar sendet zu Beginn ein `handshake`-Event mit seiner
//! Protokollversion. Die App prueft die Version und quittiert mit
//! `handshake-ack`. Eine inkompatible Version beendet den Sidecar -
//! sonst wuerde ein uralter Sidecar Events schicken, die die App nicht
//! versteht.

/// Niedrigste Protokollversion, die diese App versteht.
pub const MIN_PROTOCOL_VERSION: &str = "1.0.0";

/// Zeitfenster, in dem der Sidecar nach dem Start antworten muss.
///
/// Gemessen (2026-11-17, 5 Laeufe, warm): 164-221 ms bis zum Handshake.
/// Der Wert ist bewusst grosszuegig gewaehlt: ein kalter Start auf einem
/// fremden Rechner kann durch einen Virenscan deutlich laenger dauern, und
/// ein zu kurzes Zeitfenster wuerde den Sidecar grundlos beenden, obwohl
/// er korrekt arbeitet. Der Timeout feuert nur im Fehlerfall - längeres
/// Warten kostet im Normalbetrieb nichts.
pub const HANDSHAKE_TIMEOUT_SECS: u64 = 15;

/// Zerlegt eine Version in ihre numerischen Teile.
///
/// Unbekannte Teile (z. B. "1.0.0-beta") werden als 0 gelesen; die
/// Pruefung bleibt damit konservativ.
fn parse_version(version: &str) -> (u64, u64, u64) {
    let core = version.split(['-', '+']).next().unwrap_or(version);
    let mut parts = core.split('.');
    let major = parts.next().and_then(|p| p.trim().parse::<u64>().ok()).unwrap_or(0);
    let minor = parts.next().and_then(|p| p.trim().parse::<u64>().ok()).unwrap_or(0);
    let patch = parts.next().and_then(|p| p.trim().parse::<u64>().ok()).unwrap_or(0);
    (major, minor, patch)
}

/// Ist `version` mindestens `minimum`?
pub fn version_at_least(version: &str, minimum: &str) -> bool {
    parse_version(version) >= parse_version(minimum)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn equal_versions_are_supported() {
        assert!(version_at_least("1.0.0", MIN_PROTOCOL_VERSION));
        assert!(version_at_least(MIN_PROTOCOL_VERSION, MIN_PROTOCOL_VERSION));
    }

    #[test]
    fn newer_versions_are_supported() {
        assert!(version_at_least("1.0.1", MIN_PROTOCOL_VERSION));
        assert!(version_at_least("1.1.0", MIN_PROTOCOL_VERSION));
        assert!(version_at_least("2.0.0", MIN_PROTOCOL_VERSION));
    }

    #[test]
    fn older_versions_are_rejected() {
        assert!(!version_at_least("0.9.9", MIN_PROTOCOL_VERSION));
        assert!(!version_at_least("0.0.1", MIN_PROTOCOL_VERSION));
    }

    #[test]
    fn unparsable_versions_are_rejected() {
        assert!(!version_at_least("", MIN_PROTOCOL_VERSION));
        assert!(!version_at_least("unknown", MIN_PROTOCOL_VERSION));
    }

    #[test]
    fn prerelease_suffix_is_ignored_for_the_comparison() {
        assert!(version_at_least("1.0.0-beta", MIN_PROTOCOL_VERSION));
    }
}
