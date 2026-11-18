//! Native Windows tray and close-to-tray policy (T-514).
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Manager, Window, WindowEvent};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};

use crate::{events, settings, state};

#[derive(Default)]
pub struct WindowBehavior {
    minimize_on_close: AtomicBool,
    tray_available: AtomicBool,
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
    TrayIconBuilder::with_id("meeting-notes-tray")
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
        let accessible = app.tray_by_id("meeting-notes-tray")
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
    fn close_policy_requires_enabled_setting_available_tray_and_main_window() {
        let behavior = WindowBehavior::default();
        assert!(!behavior.should_hide("main"));
        behavior.update(&settings::WindowSettings { minimize_to_tray_on_close: true });
        assert!(!behavior.should_hide("main"), "tray failure must not hide the window");
        behavior.tray_available.store(true, Ordering::Relaxed);
        assert!(behavior.should_hide("main"));
        assert!(!behavior.should_hide("other"));
        behavior.update(&settings::WindowSettings::default());
        assert!(!behavior.should_hide("main"), "saved change applies immediately");
    }

    #[test]
    fn tray_menu_actions_distinguish_show_from_real_exit() {
        assert_eq!(menu_action(SHOW), MenuAction::Show);
        assert_eq!(menu_action(QUIT), MenuAction::Quit);
        assert_eq!(menu_action("unknown"), MenuAction::Ignore);
    }
}
