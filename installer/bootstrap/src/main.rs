#![cfg_attr(windows, windows_subsystem = "windows")]

mod i18n;
mod install;
mod ui;

use i18n::{tr, Key, Lang};
use install::Event;
use std::{
    num::NonZeroU32,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use winit::{
    application::ApplicationHandler,
    dpi::LogicalSize,
    event::{ElementState, MouseButton, WindowEvent},
    event_loop::{ActiveEventLoop, ControlFlow, EventLoop, EventLoopProxy},
    keyboard::{Key as WKey, NamedKey},
    window::{Window, WindowId},
};

const WIDTH: f64 = 1000.;
const HEIGHT: f64 = 660.;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Welcome,
    Checking,
    Downloading,
    Verifying,
    Installing,
    Done,
    Error(Key),
}

pub struct Model {
    pub lang: Lang,
    pub phase: Phase,
    pub target: PathBuf,
    pub shortcuts: bool,
    pub start_after: bool,
    pub version: String,
    pub received: u64,
    pub total: Option<u64>,
    pub hover: Option<ui::Control>,
    pub focus: Option<ui::Control>,
    pub reboot: bool,
    pub started: bool,
}

impl Model {
    fn preview() -> Self {
        Self {
            lang: Lang::De,
            phase: Phase::Welcome,
            target: PathBuf::from("C:\\Users\\Player\\AppData\\Local\\TurtleClient Launcher"),
            shortcuts: true,
            start_after: true,
            version: String::new(),
            received: 0,
            total: None,
            hover: None,
            focus: None,
            reboot: false,
            started: false,
        }
    }
    fn busy(&self) -> bool {
        matches!(
            self.phase,
            Phase::Checking | Phase::Downloading | Phase::Verifying | Phase::Installing
        )
    }
}

struct App {
    model: Model,
    renderer: ui::Renderer,
    proxy: EventLoopProxy<Event>,
    window: Option<Arc<Window>>,
    context: Option<softbuffer::Context<Arc<Window>>>,
    surface: Option<softbuffer::Surface<Arc<Window>, Arc<Window>>>,
    cancel: Arc<AtomicBool>,
    committing: Arc<AtomicBool>,
    close_requested: bool,
    cursor: (f32, f32),
    clock: Instant,
    installed_version: Option<semver::Version>,
    shift_pressed: bool,
}

impl App {
    fn start(&mut self) {
        if self.model.busy() {
            return;
        }
        if install::validate_target(&self.model.target).is_err() {
            self.model.phase = Phase::Error(Key::PathError);
            return;
        }
        self.model.phase = Phase::Checking;
        self.model.version.clear();
        self.model.received = 0;
        self.model.total = None;
        self.cancel.store(false, Ordering::Relaxed);
        let cancel = self.cancel.clone();
        let committing = self.committing.clone();
        let proxy = self.proxy.clone();
        let target = self.model.target.clone();
        let shortcuts = self.model.shortcuts;
        let installed_version = self.installed_version.clone();
        std::thread::spawn(move || {
            let report = |event| {
                let _ = proxy.send_event(event);
            };
            let result = (|| {
                let installer = install::stage(&cancel, &report)?;
                if installed_version.is_some_and(|v| v > installer.version) {
                    return Err(Key::Downgrade);
                }
                if cancel.load(Ordering::Relaxed) {
                    return Err(Key::Cancelled);
                }
                committing.store(true, Ordering::Release);
                report(Event::Installing);
                let result = install::install_verified(&installer, &target, shortcuts);
                committing.store(false, Ordering::Release);
                let reboot = result?;
                if !target.join("turtleclient-launcher.exe").is_file() {
                    return Err(Key::InstallError);
                }
                Ok((installer.version.to_string(), reboot))
            })();
            match result {
                Ok((version, reboot)) => report(Event::Done { version, reboot }),
                Err(key) => report(Event::Failed(key)),
            }
        });
    }

    fn close(&mut self, event_loop: &ActiveEventLoop) {
        if self.committing.load(Ordering::Acquire) {
            return;
        }
        if self.model.busy() {
            self.cancel.store(true, Ordering::Relaxed);
            self.close_requested = true;
        } else {
            event_loop.exit();
        }
    }

    fn activate(&mut self, control: ui::Control, event_loop: &ActiveEventLoop) {
        if !ui::controls(&self.model)
            .iter()
            .any(|(visible, _)| *visible == control)
        {
            return;
        }
        use ui::Control::*;
        match control {
            Close | Cancel => self.close(event_loop),
            Minimize => {
                if let Some(w) = &self.window {
                    w.set_minimized(true);
                }
            }
            Language if !self.model.busy() => {
                self.model.lang = if self.model.lang == Lang::De {
                    Lang::En
                } else {
                    Lang::De
                }
            }
            Folder if !self.model.busy() => {
                if let Some(path) = rfd::FileDialog::new()
                    .set_title(tr(Key::FolderTitle, self.model.lang))
                    .set_directory(&self.model.target)
                    .pick_folder()
                {
                    let path = if path.file_name().is_some_and(|s| {
                        s.to_string_lossy()
                            .eq_ignore_ascii_case("TurtleClient Launcher")
                    }) {
                        path
                    } else {
                        path.join("TurtleClient Launcher")
                    };
                    if install::validate_target(&path).is_ok() {
                        self.model.target = path;
                    }
                }
            }
            Shortcuts if !self.model.busy() => self.model.shortcuts = !self.model.shortcuts,
            StartAfter if !self.model.busy() => self.model.start_after = !self.model.start_after,
            Primary => match self.model.phase {
                Phase::Welcome | Phase::Error(_) => self.start(),
                Phase::Done => {
                    if !self.model.started && !self.model.reboot {
                        if let Err(error) = install::launch(&self.model.target) {
                            self.model.phase = Phase::Error(error);
                            return;
                        }
                    }
                    event_loop.exit();
                }
                _ => {}
            },
            _ => {}
        }
        if let Some(w) = &self.window {
            w.request_redraw();
        }
    }
}

impl ApplicationHandler<Event> for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }
        let fit = event_loop.primary_monitor().map_or(1.0, |monitor| {
            let size = monitor.size().to_logical::<f64>(monitor.scale_factor());
            (size.width * 0.94 / WIDTH)
                .min(size.height * 0.88 / HEIGHT)
                .min(1.0)
        });
        let attributes = Window::default_attributes()
            .with_title("TurtleClient Setup")
            .with_inner_size(LogicalSize::new(WIDTH * fit, HEIGHT * fit))
            .with_resizable(false)
            .with_decorations(false)
            .with_window_icon(self.renderer.icon());
        let window = Arc::new(
            event_loop
                .create_window(attributes)
                .expect("Turtle setup window"),
        );
        let context = softbuffer::Context::new(window.clone()).expect("Turtle setup display");
        let surface =
            softbuffer::Surface::new(&context, window.clone()).expect("Turtle setup surface");
        self.context = Some(context);
        self.surface = Some(surface);
        self.window = Some(window.clone());
        window.request_redraw();
    }

    fn user_event(&mut self, event_loop: &ActiveEventLoop, event: Event) {
        match event {
            Event::Checking => self.model.phase = Phase::Checking,
            Event::Downloading {
                version,
                received,
                total,
            } => {
                self.model.phase = Phase::Downloading;
                self.model.version = version;
                self.model.received = received;
                self.model.total = total;
            }
            Event::Verifying => self.model.phase = Phase::Verifying,
            Event::Installing => self.model.phase = Phase::Installing,
            Event::Done { version, reboot } => {
                self.model.phase = Phase::Done;
                self.model.version = version;
                self.model.reboot = reboot;
                if self.model.start_after && !reboot && !self.close_requested {
                    match install::launch(&self.model.target) {
                        Ok(()) => self.model.started = true,
                        Err(error) => self.model.phase = Phase::Error(error),
                    }
                }
            }
            Event::Failed(key) => {
                self.model.phase = if key == Key::Cancelled {
                    Phase::Welcome
                } else {
                    Phase::Error(key)
                }
            }
        }
        if self.close_requested && !self.model.busy() {
            event_loop.exit();
        }
        if let Some(w) = &self.window {
            w.request_redraw();
        }
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _: WindowId, event: WindowEvent) {
        match event {
            WindowEvent::CloseRequested => self.close(event_loop),
            WindowEvent::CursorMoved { position, .. } => {
                let Some(window) = &self.window else { return };
                let scale = window.inner_size().width as f32 / WIDTH as f32;
                self.cursor = (position.x as f32 / scale, position.y as f32 / scale);
                let hover = ui::hit(self.cursor, &self.model);
                if hover != self.model.hover {
                    self.model.hover = hover;
                    window.set_cursor(if hover.is_some() {
                        winit::window::CursorIcon::Pointer
                    } else {
                        winit::window::CursorIcon::Default
                    });
                    window.request_redraw();
                }
            }
            WindowEvent::MouseInput {
                state: ElementState::Released,
                button: MouseButton::Left,
                ..
            } => {
                if let Some(control) = ui::hit(self.cursor, &self.model) {
                    self.activate(control, event_loop);
                }
            }
            WindowEvent::MouseInput {
                state: ElementState::Pressed,
                button: MouseButton::Left,
                ..
            } if self.cursor.1 < 44. && self.cursor.0 < 825. => {
                if let Some(w) = &self.window {
                    let _ = w.drag_window();
                }
            }
            WindowEvent::ModifiersChanged(modifiers) => {
                self.shift_pressed = modifiers.state().shift_key()
            }
            WindowEvent::KeyboardInput { event, .. } if event.state == ElementState::Pressed => {
                match event.logical_key {
                    WKey::Named(NamedKey::Escape) => self.close(event_loop),
                    WKey::Named(NamedKey::Tab) => {
                        let controls = ui::controls(&self.model);
                        let next = self
                            .model
                            .focus
                            .and_then(|c| controls.iter().position(|v| v.0 == c))
                            .map_or(
                                if self.shift_pressed {
                                    controls.len() - 1
                                } else {
                                    0
                                },
                                |i| {
                                    if self.shift_pressed {
                                        (i + controls.len() - 1) % controls.len()
                                    } else {
                                        (i + 1) % controls.len()
                                    }
                                },
                            );
                        self.model.focus = Some(controls[next].0);
                        if let Some(w) = &self.window {
                            w.request_redraw();
                        }
                    }
                    WKey::Named(NamedKey::Enter | NamedKey::Space) => {
                        self.activate(self.model.focus.unwrap_or(ui::Control::Primary), event_loop);
                    }
                    _ => {}
                }
            }
            WindowEvent::RedrawRequested => {
                let Some(window) = &self.window else { return };
                let size = window.inner_size();
                let (Some(width), Some(height)) =
                    (NonZeroU32::new(size.width), NonZeroU32::new(size.height))
                else {
                    return;
                };
                let pixmap = self.renderer.render(
                    &self.model,
                    size.width,
                    size.height,
                    self.clock.elapsed().as_secs_f32(),
                );
                if let Some(surface) = &mut self.surface {
                    if surface.resize(width, height).is_err() {
                        return;
                    }
                    if let Ok(mut buffer) = surface.buffer_mut() {
                        for (pixel, rgba) in buffer.iter_mut().zip(pixmap.data().as_chunks::<4>().0)
                        {
                            *pixel =
                                ((rgba[0] as u32) << 16) | ((rgba[1] as u32) << 8) | rgba[2] as u32;
                        }
                        let _ = buffer.present();
                    }
                }
            }
            WindowEvent::Resized(_) => {
                if let Some(w) = &self.window {
                    w.request_redraw();
                }
            }
            _ => {}
        }
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        if self.model.busy() {
            event_loop.set_control_flow(ControlFlow::WaitUntil(
                Instant::now() + Duration::from_millis(100),
            ));
            if let Some(window) = &self.window {
                window.request_redraw();
            }
        } else {
            event_loop.set_control_flow(ControlFlow::Wait);
        }
    }
}

fn run() -> Result<(), String> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.first().is_some_and(|a| a == "--verify-latest") {
        let staged = install::stage(&AtomicBool::new(false), &|_| {})
            .map_err(|key| tr(key, Lang::En).to_owned())?;
        println!(
            "{}",
            serde_json::json!({"version":staged.version.to_string(),"sha256":staged.sha256,"signature_verified":true,"installed":false})
        );
        return Ok(());
    }
    if args.first().is_some_and(|a| a == "--verify-file") {
        let file = PathBuf::from(args.get(1).ok_or("Missing file")?);
        let signature = std::fs::read_to_string(args.get(2).ok_or("Missing signature")?)
            .map_err(|e| e.to_string())?;
        install::verify(&file, &signature).map_err(|key| tr(key, Lang::En).to_owned())?;
        println!("signature_verified=true");
        return Ok(());
    }
    if args.first().is_some_and(|a| a == "--render-preview") {
        let out = args.get(1).ok_or("Missing output file")?;
        let mut model = Model::preview();
        model.phase = match args.get(2).map(String::as_str) {
            Some("downloading") => {
                model.received = 35_000_000;
                model.total = Some(72_000_000);
                model.version = "2.3.10".into();
                Phase::Downloading
            }
            Some("installing") => Phase::Installing,
            Some("done") => {
                model.version = "2.3.10".into();
                Phase::Done
            }
            Some("error") => Phase::Error(Key::NetworkError),
            _ => Phase::Welcome,
        };
        ui::Renderer::new()
            .render(&model, 1000, 660, 1.5)
            .save_png(out)
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    let existing = install::installed();
    let mut model = Model::preview();
    model.target = existing.as_ref().map(|p| p.0.clone()).unwrap_or_else(|| {
        PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap_or_default())
            .join("TurtleClient Launcher")
    });
    let event_loop = EventLoop::<Event>::with_user_event()
        .build()
        .map_err(|e| e.to_string())?;
    let mut app = App {
        model,
        renderer: ui::Renderer::new(),
        proxy: event_loop.create_proxy(),
        window: None,
        context: None,
        surface: None,
        cancel: Arc::new(AtomicBool::new(false)),
        committing: Arc::new(AtomicBool::new(false)),
        close_requested: false,
        cursor: (0., 0.),
        clock: Instant::now(),
        installed_version: existing.and_then(|p| p.1),
        shift_pressed: false,
    };
    event_loop.run_app(&mut app).map_err(|e| e.to_string())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("Turtle Setup: {error}");
        std::process::exit(1);
    }
}
