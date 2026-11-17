use std::env;
use std::path::PathBuf;
use std::process::Command;

/// Build the C# sidecar before Tauri compiles.
///
/// The Tauri bundle resources glob (`target/sidecar-publish/*` in
/// `tauri.conf.json`) expects the publish output to exist when the
/// bundler scans it. Without this script we'd have to run
/// `npm run publish:sidecar` manually before every `tauri build`.
///
/// Cargo runs this script before it touches any Rust source, so wiring
/// it here means `tauri build` / `tauri dev` is a single command.
///
/// Pattern adapted from exphert/TauriCS (Apache-2.0).
fn main() {
    // Generated .NET files live outside this watched source tree.
    println!("cargo:rerun-if-changed=../sidecar");

    // Map Cargo profile → .NET configuration.
    let profile = env::var("PROFILE").unwrap_or_default();
    let config = if profile == "release" {
        "Release"
    } else {
        "Debug"
    };

    // Map Cargo target triple → .NET Runtime Identifier (RID).
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    let rid = match (target_os.as_str(), target_arch.as_str()) {
        ("windows", "x86_64") => "win-x64",
        ("windows", "aarch64") => "win-arm64",
        ("macos", "x86_64") => "osx-x64",
        ("macos", "aarch64") => "osx-arm64",
        ("linux", "x86_64") => "linux-x64",
        ("linux", "aarch64") => "linux-arm64",
        (os, arch) => panic!(
            "Sidecar-Publish ist für {os}-{arch} nicht implementiert. \
             Trage den passenden .NET-RID in src-tauri/build.rs nach."
        ),
    };

    let sidecar_csproj = PathBuf::from("../sidecar/MeetingNotes.Sidecar.csproj");
    let sidecar_out = PathBuf::from("target/sidecar-publish");

    // T-512: Optionaler Single-File-Publish. Mit gesetzter Variable wird der
    // Sidecar als eine einzige EXE ausgeliefert (statt 21 Dateien). Der
    // Schalter loest Cargo neu aus, damit der Wechsel auch greift.
    let single_file = env::var("MEETING_NOTES_SIDECAR_SINGLE_FILE")
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    println!("cargo:rerun-if-env-changed=MEETING_NOTES_SIDECAR_SINGLE_FILE");

    // Alte Ausgaben entfernen: sonst mischt ein spaeterer Publish die Dateien
    // zweier Varianten (Single-File-EXE alongside 21 DLLs).
    let _ = std::fs::remove_dir_all(&sidecar_out);

    println!(
        "build.rs: publishing sidecar (config={config}, rid={rid}) → {}",
        sidecar_out.display()
    );

    let mut publish = Command::new("dotnet");
    publish
        .arg("publish")
        .arg(&sidecar_csproj)
        .arg("-c")
        .arg(config)
        .arg("-r")
        .arg(rid)
        .arg("--self-contained")
        .arg("false")
        // T-512: Bei Multi-Target muss das TFM beim Publish explizit benannt
        // werden, sonst bricht der Publish mit NETSDK1047 ab.
        .arg("-f")
        .arg("net10.0-windows")
        .arg("--artifacts-path")
        .arg("target/sidecar-artifacts")
        .arg("-o")
        .arg(&sidecar_out);
    if single_file {
        // Eine einzige EXE statt 21 Dateien. Die nativen Speech-DLLs werden
        // beim Start in ein Bundle-Verzeichnis entpackt (IncludeNativeLibraries-
        // ForSelfExtract) — der Native-DLL-Pfad ist damit weiterhin belegt.
        publish
            .arg("-p:PublishSingleFile=true")
            .arg("-p:IncludeNativeLibrariesForSelfExtract=true")
            .arg("-p:DebugType=none");
    }
    let status = publish.status()
        .unwrap_or_else(|e| {
            panic!(
                "Konnte 'dotnet' nicht starten ({e}). Ist das .NET SDK installiert und im PATH?"
            )
        });

    if !status.success() {
        panic!(
            "dotnet publish für Sidecar fehlgeschlagen (exit {:?}).",
            status.code()
        );
    }

    // Hand off to Tauri (capabilities check, schema gen, …).
    tauri_build::build();
}