#![allow(clippy::too_many_arguments)]
use crate::{
    i18n::{tr, Key, Lang},
    Model, Phase,
};
use ab_glyph::{point, Font, FontArc, Glyph, PxScale, ScaleFont};
use std::collections::HashMap;
use tiny_skia::{
    Color, FillRule, GradientStop, IntSize, LinearGradient, Paint, PathBuilder, Pixmap,
    PixmapPaint, Point, Rect as SkRect, SpreadMode, Transform,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Control {
    Language,
    Minimize,
    Close,
    Folder,
    Shortcuts,
    StartAfter,
    Primary,
    Cancel,
}

#[derive(Clone, Copy)]
pub struct Rect {
    x: f32,
    y: f32,
    w: f32,
    h: f32,
}
impl Rect {
    fn new(x: f32, y: f32, w: f32, h: f32) -> Self {
        Self { x, y, w, h }
    }
    fn contains(self, p: (f32, f32)) -> bool {
        p.0 >= self.x && p.0 <= self.x + self.w && p.1 >= self.y && p.1 <= self.y + self.h
    }
}

pub fn controls(model: &Model) -> Vec<(Control, Rect)> {
    use Control::*;
    let mut out = vec![(Minimize, Rect::new(914., 0., 42., 44.))];
    if model.phase != Phase::Installing {
        out.push((Close, Rect::new(956., 0., 44., 44.)));
    }
    if !model.busy() {
        out.push((Language, Rect::new(846., 8., 55., 29.)));
    }
    match model.phase {
        Phase::Welcome => out.extend([
            (Folder, Rect::new(437., 371., 86., 35.)),
            (Shortcuts, Rect::new(44., 440., 480., 25.)),
            (StartAfter, Rect::new(44., 477., 480., 25.)),
            (Primary, Rect::new(44., 546., 488., 55.)),
        ]),
        Phase::Done => out.push((Primary, Rect::new(44., 546., 488., 55.))),
        Phase::Error(_) => out.extend([
            (Folder, Rect::new(44., 477., 195., 35.)),
            (Primary, Rect::new(44., 546., 488., 55.)),
        ]),
        Phase::Checking | Phase::Downloading | Phase::Verifying => {
            out.push((Cancel, Rect::new(44., 546., 150., 47.)))
        }
        Phase::Installing => {}
    }
    out
}
pub fn hit(p: (f32, f32), model: &Model) -> Option<Control> {
    controls(model)
        .into_iter()
        .find(|(_, r)| r.contains(p))
        .map(|v| v.0)
}

#[derive(Clone)]
struct GlyphBitmap {
    data: Vec<u8>,
    width: usize,
    height: usize,
    left: i32,
    top: i32,
}

pub struct Renderer {
    fonts: [FontArc; 4],
    glyphs: HashMap<(usize, char, u32), GlyphBitmap>,
    logo: Pixmap,
    wordmark: Pixmap,
}

fn picture(bytes: &[u8]) -> Pixmap {
    let image = image::load_from_memory(bytes)
        .expect("Turtle artwork")
        .into_rgba8();
    let (width, height) = image.dimensions();
    let mut data = image.into_raw();
    for pixel in data.as_chunks_mut::<4>().0 {
        for channel in 0..3 {
            pixel[channel] = ((pixel[channel] as u16 * pixel[3] as u16 + 127) / 255) as u8;
        }
    }
    Pixmap::from_vec(data, IntSize::from_wh(width, height).unwrap()).unwrap()
}

impl Renderer {
    pub fn new() -> Self {
        Self {
            fonts: [
                FontArc::try_from_slice(include_bytes!("../assets/Geist-Regular.ttf")).unwrap(),
                FontArc::try_from_slice(include_bytes!("../assets/Geist-SemiBold.ttf")).unwrap(),
                FontArc::try_from_slice(include_bytes!("../assets/BricolageGrotesque-Bold.ttf"))
                    .unwrap(),
                FontArc::try_from_slice(include_bytes!("../assets/PixelifySans-Medium.ttf"))
                    .unwrap(),
            ],
            glyphs: HashMap::new(),
            logo: picture(include_bytes!("../../../src-tauri/icons/icon.png")),
            wordmark: picture(include_bytes!("../../../public/turtleclient-wordmark.png")),
        }
    }
    pub fn icon(&self) -> Option<winit::window::Icon> {
        let image = image::load_from_memory(include_bytes!("../../../src-tauri/icons/icon.png"))
            .ok()?
            .into_rgba8();
        let (w, h) = image.dimensions();
        winit::window::Icon::from_rgba(image.into_raw(), w, h).ok()
    }

    fn text(
        &mut self,
        p: &mut Pixmap,
        text: &str,
        x: f32,
        y: f32,
        size: f32,
        font: usize,
        color: [u8; 3],
        scale: f32,
    ) {
        let px = size * scale;
        let scaled = self.fonts[font].as_scaled(PxScale::from(px));
        let mut cursor = x * scale;
        let baseline = y * scale + scaled.ascent();
        let mut previous = None;
        for c in text.chars() {
            let id = self.fonts[font].glyph_id(c);
            if let Some(prev) = previous {
                cursor += scaled.kern(prev, id);
            }
            let key = (font, c, px.to_bits());
            let glyph = self.glyphs.entry(key).or_insert_with(|| {
                let glyph = Glyph {
                    id,
                    scale: PxScale::from(px),
                    position: point(0., 0.),
                };
                if let Some(outline) = self.fonts[font].outline_glyph(glyph) {
                    let bounds = outline.px_bounds();
                    let width = bounds.width() as usize;
                    let height = bounds.height() as usize;
                    let mut data = vec![0; width * height];
                    outline.draw(|x, y, v| {
                        data[y as usize * width + x as usize] = (v * 255.).round() as u8
                    });
                    GlyphBitmap {
                        data,
                        width,
                        height,
                        left: bounds.min.x as i32,
                        top: bounds.min.y as i32,
                    }
                } else {
                    GlyphBitmap {
                        data: vec![],
                        width: 0,
                        height: 0,
                        left: 0,
                        top: 0,
                    }
                }
            });
            let left = cursor.round() as i32 + glyph.left;
            let top = baseline.round() as i32 + glyph.top;
            let width = p.width() as usize;
            let height = p.height() as i32;
            for gy in 0..glyph.height {
                let dy = top + gy as i32;
                if dy < 0 || dy >= height {
                    continue;
                }
                for gx in 0..glyph.width {
                    let dx = left + gx as i32;
                    if dx < 0 || dx >= width as i32 {
                        continue;
                    }
                    let a = glyph.data[gy * glyph.width + gx] as u16;
                    if a == 0 {
                        continue;
                    }
                    let i = (dy as usize * width + dx as usize) * 4;
                    let data = p.data_mut();
                    for c in 0..3 {
                        data[i + c] = ((color[c] as u16 * a + data[i + c] as u16 * (255 - a) + 127)
                            / 255) as u8;
                    }
                    data[i + 3] = 255;
                }
            }
            cursor += scaled.h_advance(id);
            previous = Some(id);
        }
    }

    fn width(&self, text: &str, size: f32, font: usize) -> f32 {
        let scaled = self.fonts[font].as_scaled(size);
        let mut width = 0.;
        let mut prev = None;
        for c in text.chars() {
            let id = scaled.glyph_id(c);
            if let Some(p) = prev {
                width += scaled.kern(p, id);
            }
            width += scaled.h_advance(id);
            prev = Some(id);
        }
        width
    }

    fn lines(
        &mut self,
        p: &mut Pixmap,
        text: &str,
        x: f32,
        y: f32,
        size: f32,
        font: usize,
        color: [u8; 3],
        scale: f32,
        gap: f32,
    ) {
        for (i, line) in text.lines().enumerate() {
            self.text(p, line, x, y + i as f32 * gap, size, font, color, scale);
        }
    }

    fn paragraph(
        &mut self,
        p: &mut Pixmap,
        text: &str,
        r: Rect,
        size: f32,
        font: usize,
        color: [u8; 3],
        scale: f32,
    ) {
        let mut line = String::new();
        let mut y = r.y;
        for word in text.split_whitespace() {
            let proposed = if line.is_empty() {
                word.to_owned()
            } else {
                format!("{line} {word}")
            };
            if self.width(&proposed, size, font) > r.w && !line.is_empty() {
                self.text(p, &line, r.x, y, size, font, color, scale);
                y += size * 1.5;
                line = word.to_owned();
            } else {
                line = proposed;
            }
        }
        if !line.is_empty() {
            self.text(p, &line, r.x, y, size, font, color, scale);
        }
    }

    fn fitted(&self, text: &str, width: f32, size: f32, font: usize) -> String {
        if self.width(text, size, font) <= width {
            return text.to_owned();
        }
        let mut chars: Vec<_> = text.chars().collect();
        while !chars.is_empty() {
            chars.remove(0);
            let result = format!("…{}", chars.iter().collect::<String>());
            if self.width(&result, size, font) <= width {
                return result;
            }
        }
        "…".into()
    }

    fn button(
        &mut self,
        p: &mut Pixmap,
        model: &Model,
        control: Control,
        r: Rect,
        label: &str,
        primary: bool,
        scale: f32,
    ) {
        let hovered = model.hover == Some(control);
        let focused = model.focus == Some(control);
        let fill = if primary {
            if hovered {
                [176, 241, 133]
            } else {
                [143, 222, 98]
            }
        } else if hovered {
            [43, 69, 53]
        } else {
            [29, 48, 37]
        };
        rectangle(
            p,
            Rect::new(r.x, r.y + 3., r.w, r.h),
            [3, 13, 8, 255],
            scale,
        );
        rectangle(p, r, [4, 16, 9, 255], scale);
        rectangle(
            p,
            Rect::new(r.x + 2., r.y + 2., r.w - 4., r.h - 4.),
            [fill[0], fill[1], fill[2], 255],
            scale,
        );
        rectangle(
            p,
            Rect::new(r.x + 3., r.y + 2., r.w - 6., 1.),
            if primary {
                [209, 255, 171, 255]
            } else {
                [64, 91, 65, 255]
            },
            scale,
        );
        let size = if primary { 17. } else { 13. };
        let color = if primary {
            [20, 42, 19]
        } else {
            [209, 231, 206]
        };
        let x = r.x + (r.w - self.width(label, size, 1)) / 2.;
        self.text(
            p,
            label,
            x,
            r.y + (r.h - size * 1.2) / 2.,
            size,
            1,
            color,
            scale,
        );
        if focused {
            outline(
                p,
                Rect::new(r.x - 4., r.y - 4., r.w + 8., r.h + 8.),
                [179, 239, 141, 255],
                scale,
            );
        }
    }

    fn checkbox(
        &mut self,
        p: &mut Pixmap,
        model: &Model,
        control: Control,
        y: f32,
        checked: bool,
        label: &str,
        scale: f32,
    ) {
        let color = if model.hover == Some(control) {
            [64, 102, 57, 255]
        } else {
            [44, 70, 45, 255]
        };
        rectangle(p, Rect::new(44., y, 20., 20.), [4, 16, 9, 255], scale);
        rectangle(
            p,
            Rect::new(46., y + 2., 16., 16.),
            if checked { [143, 222, 98, 255] } else { color },
            scale,
        );
        if checked {
            checkmark(p, 50., y + 5., [20, 47, 21, 255], scale);
        }
        self.text(p, label, 76., y + 1., 14., 0, [185, 207, 189], scale);
        if model.focus == Some(control) {
            outline(
                p,
                Rect::new(40., y - 4., 492., 28.),
                [168, 226, 131, 255],
                scale,
            );
        }
    }

    pub fn render(&mut self, model: &Model, width: u32, height: u32, time: f32) -> Pixmap {
        let scale = width as f32 / 1000.;
        let mut p = Pixmap::new(width, height).expect("Installer frame");
        p.fill(Color::from_rgba8(15, 25, 20, 255));
        let transform = Transform::from_scale(scale, scale);
        let paint = Paint {
            shader: LinearGradient::new(
                Point::from_xy(580., 40.),
                Point::from_xy(1000., 660.),
                vec![
                    GradientStop::new(0., Color::from_rgba8(44, 117, 64, 255)),
                    GradientStop::new(0.5, Color::from_rgba8(24, 84, 53, 255)),
                    GradientStop::new(1., Color::from_rgba8(15, 49, 35, 255)),
                ],
                SpreadMode::Pad,
                Transform::identity(),
            )
            .unwrap(),
            ..Default::default()
        };
        p.fill_rect(
            SkRect::from_xywh(580., 44., 420., 616.).unwrap(),
            &paint,
            transform,
            None,
        );
        for i in 0..8 {
            let a = i as f32 * 0.79;
            let b = a + 0.24;
            let mut path = PathBuilder::new();
            path.move_to(790., 300.);
            path.line_to(790. + a.cos() * 900., 300. + a.sin() * 900.);
            path.line_to(790. + b.cos() * 900., 300. + b.sin() * 900.);
            path.close();
            let mut paint = Paint::default();
            paint.set_color_rgba8(146, 215, 112, 12);
            p.fill_path(
                &path.finish().unwrap(),
                &paint,
                FillRule::Winding,
                transform,
                None,
            );
        }
        // The right-hand rays never cross into the content panel.
        rectangle(
            &mut p,
            Rect::new(0., 44., 580., 616.),
            [15, 25, 20, 255],
            scale,
        );
        for (x, y, s) in [
            (619., 112., 6.),
            (922., 165., 8.),
            (892., 365., 4.),
            (636., 465., 7.),
            (953., 492., 5.),
            (713., 84., 3.),
        ] {
            rectangle(&mut p, Rect::new(x, y, s, s), [172, 231, 136, 65], scale);
        }
        rectangle(
            &mut p,
            Rect::new(0., 0., 1000., 44.),
            [10, 21, 16, 255],
            scale,
        );
        rectangle(
            &mut p,
            Rect::new(0., 44., 1000., 1.),
            [65, 92, 64, 100],
            scale,
        );
        rectangle(
            &mut p,
            Rect::new(580., 44., 1., 616.),
            [4, 20, 12, 160],
            scale,
        );
        draw_image(&mut p, &self.logo, 18., 9., 26., 26., scale);
        self.text(
            &mut p,
            tr(Key::Setup, model.lang),
            55.,
            14.,
            13.,
            1,
            [222, 237, 215],
            scale,
        );
        for (control, r) in controls(model)
            .iter()
            .filter(|(c, _)| matches!(c, Control::Close | Control::Minimize))
        {
            if model.hover == Some(*control) {
                rectangle(
                    &mut p,
                    *r,
                    if *control == Control::Close {
                        [91, 42, 39, 255]
                    } else {
                        [39, 61, 46, 255]
                    },
                    scale,
                );
            }
        }
        self.text(&mut p, "−", 930., 10., 20., 0, [180, 200, 177], scale);
        self.text(
            &mut p,
            "×",
            971.,
            9.,
            22.,
            0,
            if model.phase == Phase::Installing {
                [67, 87, 72]
            } else {
                [180, 200, 177]
            },
            scale,
        );
        if !model.busy() {
            self.button(
                &mut p,
                model,
                Control::Language,
                Rect::new(846., 8., 55., 29.),
                if model.lang == Lang::De { "DE" } else { "EN" },
                false,
                scale,
            );
        }
        self.text(
            &mut p,
            "TURTLE LAUNCHER",
            640.,
            94.,
            14.,
            3,
            [185, 226, 169],
            scale,
        );
        draw_image(&mut p, &self.logo, 683., 177., 216., 216., scale);
        draw_image(
            &mut p,
            &self.wordmark,
            610.,
            425.,
            360.,
            360. * self.wordmark.height() as f32 / self.wordmark.width() as f32,
            scale,
        );
        for (key, y) in [
            (Key::AutoUpdates, 530.),
            (Key::Signed, 568.),
            (Key::KeepData, 606.),
        ] {
            checkmark(&mut p, 615., y + 3., [174, 235, 135, 255], scale);
            self.text(
                &mut p,
                tr(key, model.lang),
                638.,
                y,
                13.,
                0,
                [203, 227, 192],
                scale,
            );
        }
        self.text(
            &mut p,
            tr(Key::Footer, model.lang),
            44.,
            628.,
            11.,
            0,
            [111, 139, 117],
            scale,
        );

        match model.phase {
            Phase::Welcome => {
                self.text(
                    &mut p,
                    tr(Key::Kicker, model.lang),
                    44.,
                    101.,
                    13.,
                    3,
                    [143, 187, 137],
                    scale,
                );
                self.text(
                    &mut p,
                    tr(Key::HeadOne, model.lang),
                    40.,
                    135.,
                    51.,
                    2,
                    [240, 246, 234],
                    scale,
                );
                self.text(
                    &mut p,
                    tr(Key::HeadTwo, model.lang),
                    40.,
                    190.,
                    51.,
                    2,
                    [155, 223, 112],
                    scale,
                );
                self.lines(
                    &mut p,
                    tr(Key::Intro, model.lang),
                    44.,
                    264.,
                    18.,
                    0,
                    [171, 196, 173],
                    scale,
                    27.,
                );
                self.text(
                    &mut p,
                    tr(Key::Location, model.lang),
                    44.,
                    341.,
                    13.,
                    1,
                    [184, 208, 183],
                    scale,
                );
                rectangle(
                    &mut p,
                    Rect::new(44., 365., 488., 48.),
                    [3, 13, 8, 255],
                    scale,
                );
                rectangle(
                    &mut p,
                    Rect::new(46., 367., 484., 44.),
                    [23, 39, 29, 255],
                    scale,
                );
                let path = self.fitted(&model.target.to_string_lossy(), 367., 12., 0);
                self.text(&mut p, &path, 58., 382., 12., 0, [179, 200, 179], scale);
                self.button(
                    &mut p,
                    model,
                    Control::Folder,
                    Rect::new(437., 371., 86., 35.),
                    tr(Key::Change, model.lang),
                    false,
                    scale,
                );
                self.checkbox(
                    &mut p,
                    model,
                    Control::Shortcuts,
                    440.,
                    model.shortcuts,
                    tr(Key::Shortcuts, model.lang),
                    scale,
                );
                self.checkbox(
                    &mut p,
                    model,
                    Control::StartAfter,
                    477.,
                    model.start_after,
                    tr(Key::StartAfter, model.lang),
                    scale,
                );
                self.button(
                    &mut p,
                    model,
                    Control::Primary,
                    Rect::new(44., 546., 488., 55.),
                    tr(Key::Install, model.lang),
                    true,
                    scale,
                );
            }
            Phase::Done => {
                self.text(
                    &mut p,
                    tr(Key::Ready, model.lang),
                    44.,
                    101.,
                    13.,
                    3,
                    [155, 217, 125],
                    scale,
                );
                self.lines(
                    &mut p,
                    tr(Key::DoneTitle, model.lang),
                    40.,
                    142.,
                    49.,
                    2,
                    [229, 245, 218],
                    scale,
                    54.,
                );
                self.lines(
                    &mut p,
                    tr(Key::DoneBody, model.lang),
                    44.,
                    276.,
                    17.,
                    0,
                    [171, 196, 173],
                    scale,
                    26.,
                );
                self.text(
                    &mut p,
                    &format!("Turtle Launcher {}", model.version),
                    44.,
                    370.,
                    17.,
                    1,
                    [179, 230, 146],
                    scale,
                );
                if model.reboot {
                    self.paragraph(
                        &mut p,
                        tr(Key::Reboot, model.lang),
                        Rect::new(44., 416., 460., 90.),
                        15.,
                        0,
                        [232, 211, 154],
                        scale,
                    );
                }
                self.button(
                    &mut p,
                    model,
                    Control::Primary,
                    Rect::new(44., 546., 488., 55.),
                    tr(
                        if model.started || model.reboot {
                            Key::Close
                        } else {
                            Key::Finish
                        },
                        model.lang,
                    ),
                    true,
                    scale,
                );
            }
            Phase::Error(error) => {
                self.text(
                    &mut p,
                    tr(Key::Setup, model.lang),
                    44.,
                    101.,
                    13.,
                    3,
                    [192, 151, 113],
                    scale,
                );
                self.lines(
                    &mut p,
                    tr(Key::ErrorTitle, model.lang),
                    40.,
                    142.,
                    44.,
                    2,
                    [236, 238, 224],
                    scale,
                    52.,
                );
                self.paragraph(
                    &mut p,
                    tr(error, model.lang),
                    Rect::new(44., 281., 475., 110.),
                    16.,
                    0,
                    [211, 182, 155],
                    scale,
                );
                self.paragraph(
                    &mut p,
                    tr(Key::ErrorBody, model.lang),
                    Rect::new(44., 420., 465., 60.),
                    13.,
                    0,
                    [149, 175, 151],
                    scale,
                );
                self.button(
                    &mut p,
                    model,
                    Control::Folder,
                    Rect::new(44., 477., 195., 35.),
                    tr(Key::Location, model.lang),
                    false,
                    scale,
                );
                self.button(
                    &mut p,
                    model,
                    Control::Primary,
                    Rect::new(44., 546., 488., 55.),
                    tr(Key::Retry, model.lang),
                    true,
                    scale,
                );
            }
            phase => {
                self.text(
                    &mut p,
                    tr(Key::Setup, model.lang),
                    44.,
                    101.,
                    13.,
                    3,
                    [143, 187, 137],
                    scale,
                );
                self.lines(
                    &mut p,
                    tr(Key::ProgressTitle, model.lang),
                    40.,
                    142.,
                    43.,
                    2,
                    [236, 245, 228],
                    scale,
                    52.,
                );
                self.lines(
                    &mut p,
                    tr(Key::ProgressBody, model.lang),
                    44.,
                    267.,
                    16.,
                    0,
                    [164, 192, 169],
                    scale,
                    25.,
                );
                let key = match phase {
                    Phase::Checking => Key::Checking,
                    Phase::Downloading => Key::Downloading,
                    Phase::Verifying => Key::Verifying,
                    _ => Key::Installing,
                };
                self.text(
                    &mut p,
                    tr(key, model.lang),
                    44.,
                    335.,
                    14.,
                    1,
                    [197, 221, 187],
                    scale,
                );
                rectangle(
                    &mut p,
                    Rect::new(44., 366., 488., 10.),
                    [3, 13, 8, 255],
                    scale,
                );
                let amount = match phase {
                    Phase::Checking => 0.03,
                    Phase::Downloading => model.total.map_or(0.25, |total| {
                        (model.received as f32 / total as f32).clamp(0., 1.) * 0.7 + 0.06
                    }),
                    Phase::Verifying => 0.82,
                    _ => 0.92,
                };
                rectangle(
                    &mut p,
                    Rect::new(46., 368., 484. * amount, 6.),
                    [144, 220, 103, 255],
                    scale,
                );
                if matches!(phase, Phase::Checking | Phase::Installing) {
                    let x = 46. + ((time * 0.32).fract() * 420.);
                    rectangle(
                        &mut p,
                        Rect::new(x, 368., 42., 6.),
                        [202, 247, 158, 255],
                        scale,
                    );
                }
                let metrics = if let Some(total) = model.total {
                    format!(
                        "{:0.1} / {:0.1} MB",
                        model.received as f64 / 1_048_576.,
                        total as f64 / 1_048_576.
                    )
                } else {
                    model.version.clone()
                };
                self.text(&mut p, &metrics, 44., 388., 12., 0, [126, 156, 133], scale);
                for (i, key) in [Key::DownloadStep, Key::SignatureStep, Key::InstallStep]
                    .iter()
                    .enumerate()
                {
                    let current = match phase {
                        Phase::Checking | Phase::Downloading => 0,
                        Phase::Verifying => 1,
                        _ => 2,
                    };
                    let y = 430. + i as f32 * 34.;
                    let color = if i <= current {
                        [177, 219, 155]
                    } else {
                        [101, 130, 109]
                    };
                    if i < current {
                        checkmark(&mut p, 46., y + 2., [157, 224, 109, 255], scale);
                    } else {
                        outline(
                            &mut p,
                            Rect::new(47., y + 3., 10., 10.),
                            [color[0], color[1], color[2], 255],
                            scale,
                        );
                    }
                    self.text(&mut p, tr(*key, model.lang), 71., y, 13., 0, color, scale);
                }
                if phase != Phase::Installing {
                    self.button(
                        &mut p,
                        model,
                        Control::Cancel,
                        Rect::new(44., 546., 150., 47.),
                        tr(Key::Cancel, model.lang),
                        false,
                        scale,
                    );
                }
            }
        }
        p
    }
}

fn rectangle(p: &mut Pixmap, r: Rect, color: [u8; 4], scale: f32) {
    if r.w <= 0. || r.h <= 0. {
        return;
    }
    let mut paint = Paint::default();
    paint.set_color_rgba8(color[0], color[1], color[2], color[3]);
    p.fill_rect(
        SkRect::from_xywh(r.x, r.y, r.w, r.h).unwrap(),
        &paint,
        Transform::from_scale(scale, scale),
        None,
    );
}
fn outline(p: &mut Pixmap, r: Rect, color: [u8; 4], scale: f32) {
    for edge in [
        Rect::new(r.x, r.y, r.w, 1.),
        Rect::new(r.x, r.y + r.h - 1., r.w, 1.),
        Rect::new(r.x, r.y, 1., r.h),
        Rect::new(r.x + r.w - 1., r.y, 1., r.h),
    ] {
        rectangle(p, edge, color, scale);
    }
}
fn checkmark(p: &mut Pixmap, x: f32, y: f32, color: [u8; 4], scale: f32) {
    for r in [
        Rect::new(x, y + 4., 3., 3.),
        Rect::new(x + 3., y + 7., 3., 3.),
        Rect::new(x + 6., y + 4., 3., 3.),
        Rect::new(x + 9., y + 1., 3., 3.),
    ] {
        rectangle(p, r, color, scale);
    }
}
fn draw_image(p: &mut Pixmap, image: &Pixmap, x: f32, y: f32, w: f32, h: f32, scale: f32) {
    let paint = PixmapPaint {
        quality: tiny_skia::FilterQuality::Nearest,
        ..Default::default()
    };
    p.draw_pixmap(
        0,
        0,
        image.as_ref(),
        &paint,
        Transform::from_row(
            w / image.width() as f32 * scale,
            0.,
            0.,
            h / image.height() as f32 * scale,
            x * scale,
            y * scale,
        ),
        None,
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::i18n::Lang;
    #[test]
    fn only_visible_controls_accept_input_and_installation_cannot_cancel() {
        let mut model = Model::preview();
        assert_eq!(hit((100., 570.), &model), Some(Control::Primary));
        assert_eq!(hit((480., 390.), &model), Some(Control::Folder));
        model.phase = Phase::Installing;
        assert_eq!(hit((100., 570.), &model), None);
        assert_eq!(hit((980., 20.), &model), None);
        assert_eq!(hit((935., 20.), &model), Some(Control::Minimize));
    }
    #[test]
    fn installed_artwork_and_both_languages_render_without_network() {
        let mut renderer = Renderer::new();
        let mut model = Model::preview();
        for lang in [Lang::De, Lang::En] {
            for phase in [
                Phase::Welcome,
                Phase::Downloading,
                Phase::Installing,
                Phase::Done,
                Phase::Error(Key::NetworkError),
            ] {
                model.lang = lang;
                model.phase = phase;
                let frame = renderer.render(&model, 1000, 660, 0.);
                assert_eq!(frame.data().len(), 1000 * 660 * 4);
                assert!(frame.data().as_chunks::<4>().0.iter().all(|p| p[3] == 255));
            }
        }
    }
}
