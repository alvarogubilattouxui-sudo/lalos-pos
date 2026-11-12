//! Envío de bytes crudos a la impresora térmica.
//!
//! - `windows`: impresora instalada en Windows (USB). Se usa la cola de impresión en modo RAW
//!   (winspool), así funciona con el driver del fabricante o con "Generic / Text Only".
//! - `serial`: puerto COM (impresoras serie o USB que se instalan como puerto COM virtual).
//! - `network`: impresoras Ethernet/Wi-Fi en el puerto 9100 (estándar "RAW/JetDirect").

use std::io::Write;
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum PrinterTarget {
    Windows { name: String },
    Serial { port: String, baud: u32 },
    Network { host: String, port: u16 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrinterConfig {
    pub target: Option<PrinterTarget>,
    /// 58 u 80 mm
    pub paper_width: u8,
    pub auto_print_kitchen: bool,
    pub auto_print_receipt: bool,
    pub open_drawer_on_cash: bool,
    pub kitchen_copies: u8,
}

impl Default for PrinterConfig {
    fn default() -> Self {
        Self {
            target: None,
            paper_width: 80,
            auto_print_kitchen: true,
            auto_print_receipt: false,
            open_drawer_on_cash: true,
            kitchen_copies: 1,
        }
    }
}

pub fn send(target: &PrinterTarget, bytes: &[u8]) -> AppResult<()> {
    match target {
        PrinterTarget::Windows { name } => send_windows(name, bytes),
        PrinterTarget::Serial { port, baud } => send_serial(port, *baud, bytes),
        PrinterTarget::Network { host, port } => send_network(host, *port, bytes),
    }
}

fn send_network(host: &str, port: u16, bytes: &[u8]) -> AppResult<()> {
    let addr = (host, port)
        .to_socket_addrs()
        .map_err(|e| AppError::Printer(format!("Dirección inválida {host}:{port} ({e})")))?
        .next()
        .ok_or_else(|| AppError::Printer(format!("No se encontró {host}")))?;
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(3))
        .map_err(|e| AppError::Printer(format!("No responde {host}:{port} ({e})")))?;
    stream.set_write_timeout(Some(Duration::from_secs(5)))?;
    stream.write_all(bytes)?;
    stream.flush()?;
    Ok(())
}

fn send_serial(port: &str, baud: u32, bytes: &[u8]) -> AppResult<()> {
    let mut sp = serialport::new(port, if baud == 0 { 9600 } else { baud })
        .timeout(Duration::from_secs(5))
        .open()
        .map_err(|e| AppError::Printer(format!("No se pudo abrir {port} ({e})")))?;
    sp.write_all(bytes)?;
    sp.flush()?;
    Ok(())
}

#[cfg(windows)]
fn send_windows(name: &str, bytes: &[u8]) -> AppResult<()> {
    winspool::print_raw(name, bytes).map_err(AppError::Printer)
}

#[cfg(not(windows))]
fn send_windows(_name: &str, _bytes: &[u8]) -> AppResult<()> {
    Err(AppError::Printer("Las impresoras de Windows solo están disponibles en Windows".into()))
}

/// Impresoras instaladas en Windows + puertos COM disponibles.
#[derive(Debug, Serialize)]
pub struct AvailablePrinters {
    pub windows: Vec<String>,
    pub serial: Vec<String>,
}

pub fn list_available() -> AvailablePrinters {
    let serial = serialport::available_ports()
        .map(|ports| ports.into_iter().map(|p| p.port_name).collect())
        .unwrap_or_default();
    AvailablePrinters { windows: list_windows_printers(), serial }
}

#[cfg(windows)]
fn list_windows_printers() -> Vec<String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", "Get-Printer | Select-Object -ExpandProperty Name"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(not(windows))]
fn list_windows_printers() -> Vec<String> {
    Vec::new()
}

/// FFI mínimo a winspool.drv (declarado a mano para no depender de versiones del crate `windows`).
#[cfg(windows)]
mod winspool {
    use std::ffi::c_void;

    #[repr(C)]
    struct DocInfo1W {
        doc_name: *const u16,
        output_file: *const u16,
        datatype: *const u16,
    }

    #[link(name = "winspool")]
    extern "system" {
        fn OpenPrinterW(name: *const u16, handle: *mut *mut c_void, defaults: *const c_void) -> i32;
        fn ClosePrinter(handle: *mut c_void) -> i32;
        fn StartDocPrinterW(handle: *mut c_void, level: u32, info: *const DocInfo1W) -> u32;
        fn EndDocPrinter(handle: *mut c_void) -> i32;
        fn StartPagePrinter(handle: *mut c_void) -> i32;
        fn EndPagePrinter(handle: *mut c_void) -> i32;
        fn WritePrinter(handle: *mut c_void, buf: *const c_void, count: u32, written: *mut u32) -> i32;
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn last_error() -> String {
        std::io::Error::last_os_error().to_string()
    }

    pub fn print_raw(printer: &str, bytes: &[u8]) -> Result<(), String> {
        let name = wide(printer);
        let mut handle: *mut c_void = std::ptr::null_mut();
        // SAFETY: punteros válidos durante la llamada; el handle se cierra siempre.
        unsafe {
            if OpenPrinterW(name.as_ptr(), &mut handle, std::ptr::null()) == 0 {
                return Err(format!("No se pudo abrir \"{printer}\": {}", last_error()));
            }
            let result = write_job(handle, bytes);
            ClosePrinter(handle);
            result
        }
    }

    unsafe fn write_job(handle: *mut c_void, bytes: &[u8]) -> Result<(), String> {
        let doc_name = wide("Lalo's POS");
        let datatype = wide("RAW");
        let info = DocInfo1W { doc_name: doc_name.as_ptr(), output_file: std::ptr::null(), datatype: datatype.as_ptr() };

        if StartDocPrinterW(handle, 1, &info) == 0 {
            return Err(format!("StartDocPrinter falló: {}", last_error()));
        }
        if StartPagePrinter(handle) == 0 {
            EndDocPrinter(handle);
            return Err(format!("StartPagePrinter falló: {}", last_error()));
        }
        let mut written: u32 = 0;
        let ok = WritePrinter(handle, bytes.as_ptr() as *const c_void, bytes.len() as u32, &mut written);
        EndPagePrinter(handle);
        EndDocPrinter(handle);
        if ok == 0 || written as usize != bytes.len() {
            return Err(format!("WritePrinter falló ({written}/{} bytes): {}", bytes.len(), last_error()));
        }
        Ok(())
    }
}
