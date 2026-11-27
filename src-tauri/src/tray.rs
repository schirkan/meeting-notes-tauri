//! Native Windows tray and close-to-tray policy (T-514).
use std::sync::{atomic::{AtomicBool, Ordering}, Mutex};

use tauri::{AppHandle, Emitter, Manager, WebviewWindow, Window, WindowEvent};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tokio::sync::Mutex as AsyncMutex;

use crate::autostart::RecordingLifecycle;

use crate::{events, settings, state};

#[derive(Default)]
pub struct WindowBehavior {
    minimize_on_close: AtomicBool,
    hide_from_taskbar: AtomicBool,
    tray_available: AtomicBool,
    quit_pending: AtomicBool,
    quit_export_required: AtomicBool,
    quit_export_reply: Mutex<Option<QuitExportReply>>,
    recording_indicator: Mutex<RecordingIndicator>,
}

struct QuitExportReply {
    id: String,
    done: tokio::sync::oneshot::Sender<Result<(), String>>,
}

impl WindowBehavior {
    fn update(&self, settings: &settings::WindowSettings) {
        self.minimize_on_close.store(settings.minimize_to_tray_on_close, Ordering::Relaxed);
        self.hide_from_taskbar.store(settings.hide_from_taskbar, Ordering::Relaxed);
    }
    fn should_skip_taskbar(&self) -> bool {
        self.hide_from_taskbar.load(Ordering::Relaxed) && self.tray_available.load(Ordering::Relaxed)
    }
    fn should_hide(&self, label: &str) -> bool {
        label == "main" && self.minimize_on_close.load(Ordering::Relaxed) &&
            self.tray_available.load(Ordering::Relaxed)
    }
    pub fn is_quit_pending(&self) -> bool {
        self.quit_pending.load(Ordering::Acquire)
    }
    pub fn protects_transcript(&self) -> bool {
        self.is_quit_pending() || self.quit_export_required.load(Ordering::Acquire)
    }
    fn begin_quit(&self) -> bool {
        !self.quit_pending.swap(true, Ordering::AcqRel)
    }
    fn cancel_quit(&self) {
        self.quit_pending.store(false, Ordering::Release);
    }
}

const SHOW: &str = "tray-show";
const QUIT: &str = "tray-quit";
const TRAY_ID: &str = "meeting-notes-tray";

pub fn apply_window_settings(app: &AppHandle, settings: &settings::WindowSettings) {
    app.state::<WindowBehavior>().update(settings);
    update_taskbar_visibility(app);
}

fn update_taskbar_visibility(app: &AppHandle) {
    let skip_taskbar = app.state::<WindowBehavior>().should_skip_taskbar();
    if let Some(window) = app.get_webview_window("main") {
        if let Err(error) = window.set_skip_taskbar(skip_taskbar) {
            log_error(app, &format!("Taskbar visibility could not be updated: {error}"));
        }
    }
}

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
            Self::Recording => "Meeting Notes - Transcribing",
            Self::Paused => "Meeting Notes - Paused",
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
            let tray = handle.tray_by_id(TRAY_ID).ok_or("The system tray icon is not available.")?;
            let icon = handle.default_window_icon().ok_or("The app icon for the system tray is missing.")?;
            tray.set_icon(Some(indicator_icon(icon, indicator))).map_err(|e| e.to_string())?;
            tray.set_tooltip(Some(indicator.tooltip())).map_err(|e| e.to_string())
        })();
        match result {
            Ok(()) => *current = indicator,
            Err(error) => log_error(&handle, &format!("The system tray transcription status could not be updated: {error}")),
        }
    }) {
        log_error(app, &format!("The system tray transcription status could not be scheduled: {error}"));
    }
}

#[derive(Debug, PartialEq, Eq)]
enum MenuAction { Show, Quit, Ignore }
fn menu_action(id: &str) -> MenuAction {
    match id { SHOW => MenuAction::Show, QUIT => MenuAction::Quit, _ => MenuAction::Ignore }
}

pub fn init(app: &AppHandle) -> Result<(), String> {
    let show = MenuItem::with_id(app, SHOW, "Show", true, None::<&str>).map_err(|e| e.to_string())?;
    let quit = MenuItem::with_id(app, QUIT, "Quit", true, None::<&str>).map_err(|e| e.to_string())?;
    let menu = Menu::with_items(app, &[&show, &quit]).map_err(|e| e.to_string())?;
    let icon = app.default_window_icon().cloned().ok_or("The app icon for the system tray is missing.")?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("Meeting Notes")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match menu_action(event.id().as_ref()) {
            MenuAction::Show => {
                if let Err(error) = show_main(app) { log_error(app, &error); }
            }
            MenuAction::Quit => request_quit(app),
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

pub(crate) fn show_main(app: &AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("The main window is not available.")?;
    window.show().map_err(|e| e.to_string())?;
    window.unminimize().map_err(|e| e.to_string())?;
    update_taskbar_visibility(app);
    window.set_focus().map_err(|e| e.to_string())
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if window.label() != "main" { return; }
        api.prevent_close();
        let app = window.app_handle();
        let behavior = app.state::<WindowBehavior>();
        if behavior.is_quit_pending() { return; }
        if behavior.should_hide(window.label()) && app.tray_by_id(TRAY_ID)
            .and_then(|tray| tray.rect().ok().flatten()).is_some() {
            match window.hide() {
                Ok(()) => return,
                Err(error) => log_error(app, &format!("The window could not be hidden into the system tray: {error}")),
            }
        }
        request_quit(app);
    }
}

fn request_quit(app: &AppHandle) {
    if !app.state::<WindowBehavior>().begin_quit() { return; }
    let was_running = app.state::<state::AppState>().snapshot_status().running;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let lifecycle = app.state::<AsyncMutex<RecordingLifecycle>>();
        let running = {
            // Include a session whose start is already in progress.
            let _guard = lifecycle.lock().await;
            app.state::<state::AppState>().snapshot_status().running
        };
        if !was_running && !running {
            let behavior = app.state::<WindowBehavior>();
            if behavior.quit_export_required.load(Ordering::Acquire)
                || app.state::<state::AppState>().has_stop_error()
            {
                behavior.quit_export_required.store(true, Ordering::Release);
                finish_quit(&app).await;
            } else {
                app.exit(0);
            }
            return;
        }
        let handle = app.clone();
        if let Err(error) = app.run_on_main_thread(move || show_quit_confirmation(&handle)) {
            app.state::<WindowBehavior>().cancel_quit();
            log_error(&app, &format!("The quit confirmation could not be shown: {error}"));
        }
    });
}

fn show_quit_confirmation(app: &AppHandle) {
    let mut dialog = app.dialog()
        .message("A transcription session is still open. Quitting stops the session and saves the transcript before closing Meeting Notes.")
        .title("Quit Meeting Notes?")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom("Quit".into(), "Cancel".into()));
    // An unowned prompt is needed while the main window is hidden in the tray.
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false) {
            dialog = dialog.parent(&window);
        }
    }
    let app = app.clone();
    dialog.show(move |confirmed| {
        if confirmed {
            app.state::<WindowBehavior>().quit_export_required.store(true, Ordering::Release);
            tauri::async_runtime::spawn(async move { finish_quit(&app).await });
        } else {
            app.state::<WindowBehavior>().cancel_quit();
        }
    });
}

async fn finish_quit(app: &AppHandle) {
    let result = match crate::commands::stop_recording_for_quit(app).await {
        Ok(_) => request_quit_export(app).await,
        Err(error) => Err(format!("{error} Quit again to save the transcript collected so far.")),
    };
    match result {
        Ok(()) => app.exit(0),
        Err(error) => {
            let message = format!("Meeting Notes stayed open. {error}");
            log_error(app, &message);
            let handle = app.clone();
            if app.run_on_main_thread(move || {
                let _ = show_main(&handle);
                handle.dialog().message(message).title("Could not quit Meeting Notes")
                    .kind(MessageDialogKind::Error).show(move |_| {
                        handle.state::<WindowBehavior>().cancel_quit();
                    });
            }).is_err() {
                app.state::<WindowBehavior>().cancel_quit();
            }
        }
    }
}

async fn request_quit_export(app: &AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("The main window is not available.")?;
    let behavior = app.state::<WindowBehavior>();
    let id = uuid::Uuid::new_v4().to_string();
    let (done, reply) = tokio::sync::oneshot::channel();
    *behavior.quit_export_reply.lock().expect("Quit export mutex poisoned") = Some(QuitExportReply { id: id.clone(), done });
    let result = async {
        window.emit(events::EVENT_QUIT_EXPORT, id).map_err(|error| error.to_string())?;
        tokio::time::timeout(std::time::Duration::from_secs(30), reply).await
            .map_err(|_| "The transcript export did not report completion. Quit again to retry.".to_string())?
            .map_err(|_| "The transcript export was interrupted. Quit again to retry.".to_string())?
    }.await;
    behavior.quit_export_reply.lock().expect("Quit export mutex poisoned").take();
    result
}

#[tauri::command]
pub fn complete_quit_export(window: WebviewWindow, request_id: String, error: Option<String>) {
    if window.label() != "main" { return; }
    let behavior = window.state::<WindowBehavior>();
    let mut reply = behavior.quit_export_reply.lock().expect("Quit export mutex poisoned");
    if reply.as_ref().is_some_and(|reply| reply.id == request_id) {
        if let Some(reply) = reply.take() {
            let _ = reply.done.send(error.map_or(Ok(()), Err));
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
            running: false, paused: true, started_at: None, recording: None,
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
        behavior.update(&settings::WindowSettings::default());
        assert!(!behavior.should_hide("main"), "tray failure must not hide the window");
        behavior.tray_available.store(true, Ordering::Relaxed);
        assert!(behavior.should_hide("main"));
        assert!(!behavior.should_hide("other"));
        behavior.update(&settings::WindowSettings {
            minimize_to_tray_on_close: false,
            ..Default::default()
        });
        assert!(!behavior.should_hide("main"), "explicitly saved false applies immediately");
    }

    #[test]
    fn taskbar_policy_requires_tray_and_is_independent_of_close_policy() {
        let behavior = WindowBehavior::default();
        let mut settings = settings::WindowSettings {
            minimize_to_tray_on_close: false,
            ..Default::default()
        };
        behavior.update(&settings);
        assert!(!behavior.should_skip_taskbar());
        behavior.tray_available.store(true, Ordering::Relaxed);
        assert!(behavior.should_skip_taskbar());
        assert!(!behavior.should_hide("main"));
        settings.hide_from_taskbar = false;
        settings.minimize_to_tray_on_close = true;
        behavior.update(&settings);
        assert!(!behavior.should_skip_taskbar());
        assert!(behavior.should_hide("main"));
    }

    #[test]
    fn quit_requests_are_deduplicated_until_cancelled() {
        let behavior = WindowBehavior::default();
        assert!(behavior.begin_quit());
        assert!(behavior.is_quit_pending());
        assert!(!behavior.begin_quit(), "repeated close or Quit must not open another prompt");
        behavior.cancel_quit();
        assert!(!behavior.is_quit_pending(), "cancelling allows transcription starts again");
        assert!(behavior.begin_quit(), "the user can request Quit again after cancelling");
    }

    #[test]
    fn tray_menu_actions_distinguish_show_from_real_exit() {
        assert_eq!(menu_action(SHOW), MenuAction::Show);
        assert_eq!(menu_action(QUIT), MenuAction::Quit);
        assert_eq!(menu_action("unknown"), MenuAction::Ignore);
    }
}
