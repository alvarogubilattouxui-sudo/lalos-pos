pub mod escpos;
pub mod tickets;
pub mod transport;

use crate::db::{self, keys};
use crate::error::{AppError, AppResult};
use crate::orders::Order;
use crate::state::AppState;
use transport::{PrinterConfig, PrinterTarget};

pub fn load_config(state: &AppState) -> AppResult<PrinterConfig> {
    let raw = {
        let conn = state.db();
        db::kv_get(&conn, keys::PRINTER_CONFIG)?
    };
    Ok(raw.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default())
}

pub fn save_config(state: &AppState, cfg: &PrinterConfig) -> AppResult<()> {
    let conn = state.db();
    db::kv_set(&conn, keys::PRINTER_CONFIG, &serde_json::to_string(cfg)?)
}

pub fn require_target(cfg: &PrinterConfig) -> AppResult<PrinterTarget> {
    cfg.target
        .clone()
        .ok_or_else(|| AppError::Printer("No hay impresora configurada (Configuración → Impresora)".into()))
}

/// Solo la comanda de cocina: para pedidos que llegan de la web (no hay cobro en la caja).
pub fn print_kitchen(cfg: &PrinterConfig, order: &Order) -> AppResult<()> {
    if !cfg.auto_print_kitchen {
        return Ok(());
    }
    let target = require_target(cfg)?;
    let copies = cfg.kitchen_copies.clamp(1, 3);
    let mut job = Vec::new();
    for n in 1..=copies {
        let label = if copies > 1 { Some(format!("Copia {n}/{copies}")) } else { None };
        job.extend(tickets::kitchen(order, cfg.paper_width, label.as_deref()));
    }
    transport::send(&target, &job)
}

/// Imprime lo que corresponda al cobrar, según la configuración.
pub fn print_on_checkout(cfg: &PrinterConfig, order: &Order) -> AppResult<()> {
    if !cfg.auto_print_kitchen && !cfg.auto_print_receipt {
        return Ok(());
    }
    let target = require_target(cfg)?;
    let drawer = cfg.open_drawer_on_cash && order.payment_method == "cash";

    // Un solo trabajo de impresión: comprobante (si va) + comandas. Menos chances de que se mezclen.
    let mut job = Vec::new();
    if cfg.auto_print_receipt {
        job.extend(tickets::receipt(order, cfg.paper_width, drawer));
    } else if drawer {
        let mut p = escpos::EscPos::new(cfg.paper_width);
        p.open_drawer();
        job.extend(p.finish());
    }
    if cfg.auto_print_kitchen {
        let copies = cfg.kitchen_copies.clamp(1, 3);
        for n in 1..=copies {
            let label = if copies > 1 { Some(format!("Copia {n}/{copies}")) } else { None };
            job.extend(tickets::kitchen(order, cfg.paper_width, label.as_deref()));
        }
    }
    transport::send(&target, &job)
}
