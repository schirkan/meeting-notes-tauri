//! Native Windows tray and close-to-tray policy (T-514).
use std::sync::{atomic::{AtomicBool, Ordering}, Mutex};

use tauri::{AppHandle, Manager, Window, WindowEvent};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};

use crate::{events, settings, state};

#[derive(Default)]
pub struct WindowBehavior {
    minimize_on_close: AtomicBool,
    tray_available: AtomicBool,
    recording_indicator: Mutex<RecordingIndicator>,
}

impl WindowBehavior {
    pub fn update(&self, settings: &settings::WindowSettings) {
        self.minimize_on_close.store(settings.minimize_to_tray_on_close, Ordering::Relaxed);
    }
    fn should_hide(&self, label: &str) -> bool {
        label == "main" && self.minimize_on_close.load(Ordering::Relaxed) &&
            self.tray_available.load(Ordering::Relaxed)
    }
}

const SHOW: &str = "tray-show";
const QUIT: &str = "tray-quit";
const TRAY_ID: &str = "meeting-notes-tray";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum RecordingIndicator {
    #[default]
    Idle,
    Recording,
    Paused,
}

impl RecordingIndicator {
    fn from_status(status: &events::TranscriptStatus) -> Self {
        if !status.running { Self::Idle }
        else if status.paused { Self::Paused }
        else { Self::Recording }
    }

    fn tooltip(self) -> &'static str {
        match self {
            Self::Idle => "Meeting Notes",
            Self::Recording => "Meeting Notes - Aufnahme",
            Self::Paused => "Meeting Notes - Pausiert",
        }
    }
}

fn indicator_icon(icon: &tauri::image::Image<'_>, indicator: RecordingIndicator) -> tauri::image::Image<'static> {
    let tint = match indicator {
        RecordingIndicator::Idle => return icon.clone().to_owned(),
        RecordingIndicator::Recording => [255_u16, 64, 64],
        RecordingIndicator::Paused => [255_u16, 200, 40],
    };
    let mut rgba = icon.rgba().to_vec();
    for pixel in rgba.chunks_exact_mut(4) {
        if pixel[3] == 0 { continue; }
        // Preserve the waveform's contrast and alpha while tinting its original pixels.
        let brightness = u16::from(pixel[0].max(pixel[1]).max(pixel[2]));
        for channel in 0..3 {
            pixel[channel] = (brightness * tint[channel] / 255) as u8;
        }
    }
    tauri::image::Image::new_owned(rgba, icon.width(), icon.height())
}

pub fn update_recording_indicator(app: &AppHandle) {
    if !app.state::<WindowBehavior>().tray_available.load(Ordering::Relaxed) { return; }
    let handle = app.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        // Read the latest state on the UI thread so queued updates cannot restore an old color.
        let indicator = RecordingIndicator::from_status(&handle.state::<state::AppState>().snapshot_status());
        let behavior = handle.state::<WindowBehavior>();
        let mut current = behavior.recording_indicator.lock().expect("Tray indicator mutex poisoned");
        if *current == indicator { return; }
        let result = (|| -> Result<(), String> {
            let tray = handle.tray_by_id(TRAY_ID).ok_or("Systray-Icon nicht verfuegbar.")?;
            let icon = handle.default_window_icon().ok_or("App-Icon fuer Systray fehlt.")?;
            tray.set_icon(Some(indicator_icon(icon, indicator))).map_err(|e| e.to_string())?;
            tray.set_tooltip(Some(indicator.tooltip())).map_err(|e| e.to_string())
        })();
        match result {
            Ok(()) => *current = indicator,
            Err(error) => log_error(&handle, &format!("Systray-Aufnahmestatus konnte nicht aktualisiert werden: {error}")),
        }
    }) {
        log_error(app, &format!("Systray-Aufnahmestatus konnte nicht eingeplant werden: {error}"));
    }
}

#[derive(Debug, PartialEq, Eq)]
enum MenuAction { Show, Quit, Ignore }
fn menu_action(id: &str) -> MenuAction {
    match id { SHOW => MenuAction::Show, QUIT => MenuAction::Quit, _ => MenuAction::Ignore }
}

pub fn init(app: &AppHandle) -> Result<(), String> {
    let show = MenuItem::with_id(app, SHOW, "Anzeigen", true, None::<&str>).map_err(|e| e.to_string())?;
    let quit = MenuItem::with_id(app, QUIT, "Beenden", true, None::<&str>).map_err(|e| e.to_string())?;
    let menu = Menu::with_items(app, &[&show, &quit]).map_err(|e| e.to_string())?;
    let icon = app.default_window_icon().cloned().ok_or("App-Icon fuer Systray fehlt.")?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("Meeting Notes")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match menu_action(event.id().as_ref()) {
            MenuAction::Show => {
                if let Err(error) = show_main(app) { log_error(app, &error); }
            }
            MenuAction::Quit => app.exit(0), // App exit, not window close: bypass close-to-tray.
            MenuAction::Ignore => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(event, TrayIconEvent::DoubleClick { button: MouseButton::Left, .. }) {
                if let Err(error) = show_main(tray.app_handle()) { log_error(tray.app_handle(), &error); }
            }
        })
        .build(app).map_err(|e| e.to_string())?;
    // Tauri's app manager retains the built tray until app exit.
    app.state::<WindowBehavior>().tray_available.store(true, Ordering::Relaxed);
    Ok(())
}

fn show_main(app: &AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("Hauptfenster nicht verfuegbar.")?;
    window.show().map_err(|e| e.to_string())?;
    window.unminimize().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        let app = window.app_handle();
        let accessible = app.tray_by_id(TRAY_ID)
            .and_then(|tray| tray.rect().ok().flatten()).is_some();
        if app.state::<WindowBehavior>().should_hide(window.label()) && accessible {
            match window.hide() {
                Ok(()) => api.prevent_close(),
                Err(error) => log_error(app, &format!("Fenster konnte nicht in den Systray verborgen werden: {error}")),
            }
        }
    }
}

fn log_error(app: &AppHandle, message: &str) {
    let entry = app.state::<state::AppState>().push_debug(
        state::DebugLogEntrySource::Main, state::DebugLogEntryLevel::Warn, message);
    events::emit_debug(app, &entry);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recording_indicator_tracks_start_pause_resume_and_stop() {
        let state = state::AppState::default();
        assert_eq!(RecordingIndicator::from_status(&state.snapshot_status()), RecordingIndicator::Idle);
        assert_eq!(RecordingIndicator::from_status(&state.mark_started()), RecordingIndicator::Recording);
        assert_eq!(RecordingIndicator::from_status(&state.mark_paused()), RecordingIndicator::Paused);
        assert_eq!(RecordingIndicator::from_status(&state.mark_resumed()), RecordingIndicator::Recording);
        assert_eq!(RecordingIndicator::from_status(&state.mark_stopped()), RecordingIndicator::Idle);
        assert_eq!(RecordingIndicator::from_status(&events::TranscriptStatus {
            running: false, paused: true, started_at: None,
        }), RecordingIndicator::Idle);
    }

    #[test]
    fn recording_icons_preserve_shape_alpha_and_restore_the_original() {
        let original = tauri::image::Image::new_owned(vec![160, 140, 240, 255, 40, 30, 60, 120, 0, 0, 0, 0], 3, 1);
        let red = indicator_icon(&original, RecordingIndicator::Recording);
        let yellow = indicator_icon(&original, RecordingIndicator::Paused);
        assert_eq!((red.width(), red.height()), (3, 1));
        assert_eq!((yellow.width(), yellow.height()), (3, 1));
        for icon in [&red, &yellow] {
            assert_eq!(icon.rgba()[3], 255);
            assert_eq!(icon.rgba()[7], 120);
            assert_eq!(&icon.rgba()[8..], &[0, 0, 0, 0]);
            assert!(icon.rgba()[0] > icon.rgba()[4], "waveform remains brighter than background");
        }
        assert!(red.rgba()[0] > red.rgba()[1] * 3);
        assert_eq!(red.rgba()[1], red.rgba()[2]);
        assert!(yellow.rgba()[0] > yellow.rgba()[1]);
        assert!(yellow.rgba()[1] > yellow.rgba()[2] * 3);
        assert_eq!(indicator_icon(&original, RecordingIndicator::Idle).rgba(), original.rgba());
        assert_eq!(original.rgba(), &[160, 140, 240, 255, 40, 30, 60, 120, 0, 0, 0, 0]);
    }

    #[test]
    fn close_policy_requires_enabled_setting_available_tray_and_main_window() {
        let behavior = WindowBehavior::default();
        assert!(!behavior.should_hide("main"));
        behavior.update(&settings::WindowSettings { minimize_to_tray_on_close: true });
        assert!(!behavior.should_hide("main"), "tray failure must not hide the window");
        behavior.tray_available.store(true, Ordering::Relaxed);
        assert!(behavior.should_hide("main"));
        assert!(!behavior.should_hide("other"));
        behavior.update(&settings::WindowSettings { minimize_to_tray_on_close: false });
        assert!(!behavior.should_hide("main"), "explicitly saved false applies immediately");
    }

    #[test]
    fn tray_menu_actions_distinguish_show_from_real_exit() {
        assert_eq!(menu_action(SHOW), MenuAction::Show);
        assert_eq!(menu_action(QUIT), MenuAction::Quit);
        assert_eq!(menu_action("unknown"), MenuAction::Ignore);
    }
}
