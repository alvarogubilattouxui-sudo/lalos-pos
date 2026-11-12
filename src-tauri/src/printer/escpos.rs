//! Generador de comandos ESC/POS (Epson y compatibles: Xprinter, 3nStar, Gadnic, Hasar térmicas…).
//! Sin dependencias: produce el `Vec<u8>` crudo que se manda a la impresora.

const ESC: u8 = 0x1B;
const GS: u8 = 0x1D;

#[derive(Clone, Copy)]
pub enum Align {
    Left = 0,
    Center = 1,
    Right = 2,
}

pub struct EscPos {
    buf: Vec<u8>,
    /// Caracteres por línea en tamaño normal (Font A): 32 en 58 mm, 48 en 80 mm.
    pub cols: usize,
    width_mult: usize,
}

impl EscPos {
    pub fn new(paper_mm: u8) -> Self {
        let cols = if paper_mm >= 80 { 48 } else { 32 };
        let mut p = Self { buf: Vec::with_capacity(1024), cols, width_mult: 1 };
        p.raw(&[ESC, b'@']); // reset
        p.raw(&[ESC, b't', 2]); // tabla de caracteres PC850 (acentos y ñ)
        p
    }

    pub fn raw(&mut self, bytes: &[u8]) -> &mut Self {
        self.buf.extend_from_slice(bytes);
        self
    }

    pub fn align(&mut self, a: Align) -> &mut Self {
        self.raw(&[ESC, b'a', a as u8])
    }

    pub fn bold(&mut self, on: bool) -> &mut Self {
        self.raw(&[ESC, b'E', on as u8])
    }

    /// Texto en negativo (blanco sobre negro): ideal para resaltar notas en cocina.
    pub fn reverse(&mut self, on: bool) -> &mut Self {
        self.raw(&[GS, b'B', on as u8])
    }

    pub fn underline(&mut self, on: bool) -> &mut Self {
        self.raw(&[ESC, b'-', on as u8])
    }

    /// Multiplicador de tamaño 1..=8 en ancho y alto (GS ! n).
    pub fn size(&mut self, width: u8, height: u8) -> &mut Self {
        let w = width.clamp(1, 8);
        let h = height.clamp(1, 8);
        self.width_mult = w as usize;
        self.raw(&[GS, b'!', ((w - 1) << 4) | (h - 1)])
    }

    pub fn normal(&mut self) -> &mut Self {
        self.size(1, 1).bold(false).reverse(false).underline(false)
    }

    /// Columnas disponibles con el tamaño actual.
    pub fn current_cols(&self) -> usize {
        (self.cols / self.width_mult).max(1)
    }

    pub fn text(&mut self, s: &str) -> &mut Self {
        let encoded = encode_cp850(s);
        self.buf.extend_from_slice(&encoded);
        self
    }

    pub fn line(&mut self, s: &str) -> &mut Self {
        self.text(s).raw(b"\n")
    }

    /// Línea con corte de palabras según el ancho actual.
    pub fn wrapped(&mut self, s: &str, indent: usize) -> &mut Self {
        let width = self.current_cols();
        for l in wrap(s, width, indent) {
            self.line(&l);
        }
        self
    }

    /// Bloque con sangría fija en todas las líneas.
    pub fn indented(&mut self, s: &str, indent: usize) -> &mut Self {
        let width = self.current_cols().saturating_sub(indent).max(8);
        for l in wrap(s, width, 0) {
            self.line(&format!("{}{}", " ".repeat(indent), l));
        }
        self
    }

    /// Texto a la izquierda y a la derecha en la misma línea (ej: producto … precio).
    pub fn two_cols(&mut self, left: &str, right: &str) -> &mut Self {
        let width = self.current_cols();
        let right_len = right.chars().count();
        let max_left = width.saturating_sub(right_len + 1).max(1);
        let lines = wrap(left, max_left, 0);
        let n = lines.len();
        for (i, l) in lines.into_iter().enumerate() {
            if i + 1 == n {
                let pad = width.saturating_sub(l.chars().count() + right_len);
                self.line(&format!("{l}{}{right}", " ".repeat(pad.max(1))));
            } else {
                self.line(&l);
            }
        }
        self
    }

    pub fn separator(&mut self, ch: char) -> &mut Self {
        let w = self.current_cols();
        self.line(&ch.to_string().repeat(w))
    }

    pub fn feed(&mut self, lines: u8) -> &mut Self {
        self.raw(&[ESC, b'd', lines])
    }

    /// Avanza el papel y hace corte parcial (GS V 66 n).
    pub fn cut(&mut self) -> &mut Self {
        self.raw(&[GS, b'V', 66, 3])
    }

    /// Pulso al cajón de dinero conectado a la impresora (ESC p 0 25 250).
    pub fn open_drawer(&mut self) -> &mut Self {
        self.raw(&[ESC, b'p', 0, 25, 250])
    }

    pub fn beep(&mut self) -> &mut Self {
        // ESC B n t — buzzer en la mayoría de las impresoras chinas compatibles
        self.raw(&[ESC, b'B', 2, 2])
    }

    pub fn finish(self) -> Vec<u8> {
        self.buf
    }
}

/// Corta texto en líneas de `width` columnas; las líneas siguientes llevan `indent` espacios.
pub fn wrap(s: &str, width: usize, indent: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let width = width.max(indent + 4);
    for word in s.split_whitespace() {
        let cur_len = current.chars().count();
        let word_len = word.chars().count();
        let limit = width;
        if cur_len == 0 {
            if !out.is_empty() {
                current.push_str(&" ".repeat(indent));
            }
            current.push_str(word);
        } else if cur_len + 1 + word_len <= limit {
            current.push(' ');
            current.push_str(word);
        } else {
            out.push(std::mem::take(&mut current));
            current.push_str(&" ".repeat(indent));
            current.push_str(word);
        }
        // Palabras más largas que la línea: se parten a la fuerza
        while current.chars().count() > limit {
            let head: String = current.chars().take(limit).collect();
            let tail: String = current.chars().skip(limit).collect();
            out.push(head);
            current = format!("{}{}", " ".repeat(indent), tail);
        }
    }
    if !current.trim().is_empty() {
        out.push(current);
    }
    if out.is_empty() {
        out.push(String::new());
    }
    out
}

/// UTF-8 → página de códigos 850 (la que seleccionamos con ESC t 2).
pub fn encode_cp850(s: &str) -> Vec<u8> {
    s.chars()
        .map(|c| match c {
            c if c.is_ascii() => c as u8,
            'á' => 0xA0, 'é' => 0x82, 'í' => 0xA1, 'ó' => 0xA2, 'ú' => 0xA3,
            'Á' => 0xB5, 'É' => 0x90, 'Í' => 0xD6, 'Ó' => 0xE0, 'Ú' => 0xE9,
            'ñ' => 0xA4, 'Ñ' => 0xA5, 'ü' => 0x81, 'Ü' => 0x9A,
            '¿' => 0xA8, '¡' => 0xAD, '°' => 0xF8, 'º' => 0xA7, 'ª' => 0xA6,
            '´' | '’' | '‘' => b'\'',
            '“' | '”' => b'"',
            '–' | '—' => b'-',
            '·' | '•' => 0xFA,
            '…' => b'.',
            _ => b'?',
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_spanish() {
        assert_eq!(encode_cp850("ñandú"), vec![0xA4, b'a', b'n', b'd', 0xA3]);
    }

    #[test]
    fn wraps_long_text() {
        let lines = wrap("La Lalo's Crispy triple con papas y Salsa Lalo's", 16, 2);
        assert!(lines.iter().all(|l| l.chars().count() <= 16));
        assert!(lines[1].starts_with("  "));
    }

    #[test]
    fn two_cols_fits_width() {
        let mut p = EscPos::new(58);
        p.two_cols("1x Doble queso + papas", "$ 14.000");
        let bytes = p.finish();
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.lines().all(|l| l.trim_start_matches(|c: char| !c.is_ascii_graphic() && c != ' ').chars().count() <= 40));
    }
}
