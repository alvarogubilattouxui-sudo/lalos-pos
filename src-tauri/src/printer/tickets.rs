//! Formato de los tickets: comanda de cocina, comprobante para el cliente y página de prueba.

use chrono::{DateTime, Local};

use super::escpos::{Align, EscPos};
use crate::orders::Order;

fn local_time(rfc3339: &str, fmt: &str) -> String {
    DateTime::parse_from_rfc3339(rfc3339)
        .map(|d| d.with_timezone(&Local).format(fmt).to_string())
        .unwrap_or_default()
}

pub fn money(v: f64) -> String {
    // 14000 → "$14.000" (formato argentino, sin decimales si es entero)
    let neg = v < 0.0;
    let cents = (v.abs() * 100.0).round() as i64;
    let int = cents / 100;
    let dec = cents % 100;
    let digits = int.to_string();
    let mut grouped = String::new();
    for (i, ch) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            grouped.push('.');
        }
        grouped.push(ch);
    }
    let sign = if neg { "-" } else { "" };
    if dec == 0 {
        format!("{sign}${grouped}")
    } else {
        format!("{sign}${grouped},{dec:02}")
    }
}

pub fn order_type_label(t: &str) -> &'static str {
    match t {
        "local" => "COMER ACÁ",
        "delivery" => "DELIVERY",
        _ => "PARA LLEVAR",
    }
}

pub fn payment_label(p: &str) -> &'static str {
    match p {
        "cash" => "Efectivo",
        "card" => "Débito / Crédito",
        "qr" => "QR / MercadoPago",
        "transfer" => "Transferencia",
        _ => "Otro",
    }
}

/// Comanda para la cocina: grande, sin precios, modificaciones resaltadas.
pub fn kitchen(order: &Order, paper_mm: u8, copy_label: Option<&str>) -> Vec<u8> {
    let mut p = EscPos::new(paper_mm);
    p.beep();

    p.align(Align::Center).size(2, 2).bold(true).line(&format!("#{:03}", order.ticket_number));
    p.size(1, 2).line(order_type_label(&order.order_type));
    p.normal().align(Align::Center).line(&local_time(&order.created_at, "%H:%M  ·  %d/%m"));
    if let Some(name) = &order.customer_name {
        p.size(1, 2).bold(true).line(name).normal();
    }
    if let Some(hora) = &order.pickup_time {
        p.size(1, 2).bold(true).line(&format!("RETIRO {hora}")).normal();
    }
    if order.paid_at.is_none() {
        p.bold(true).line(&format!("PAGO: {} (sin cobrar)", payment_label(&order.payment_method))).bold(false);
    }
    if let Some(label) = copy_label {
        p.line(label);
    }
    p.align(Align::Left).separator('=');

    for item in &order.items {
        p.size(1, 2).bold(true).wrapped(&format!("{}x {}", item.quantity, item.product_name.to_uppercase()), 3);
        p.normal();
        if let Some(mods) = &item.modifications {
            let width = p.current_cols().saturating_sub(3);
            for part in mods.split(" · ").filter(|s| !s.trim().is_empty()) {
                for chunk in super::escpos::wrap(part.trim(), width, 0) {
                    p.bold(true).line(&format!(">> {chunk}")).bold(false);
                }
            }
        }
        p.separator('-');
    }

    if let Some(notes) = &order.notes {
        p.bold(true).line("NOTA DEL PEDIDO:").bold(false).size(1, 2).wrapped(notes, 0).normal();
        p.separator('-');
    }

    let units: i64 = order.items.iter().map(|i| i.quantity).sum();
    p.align(Align::Center).line(&format!("{units} producto(s)"));
    p.feed(4).cut();
    p.finish()
}

/// Comprobante para el cliente (no fiscal).
pub fn receipt(order: &Order, paper_mm: u8, open_drawer: bool) -> Vec<u8> {
    let mut p = EscPos::new(paper_mm);
    if open_drawer {
        p.open_drawer();
    }

    p.align(Align::Center).size(2, 2).bold(true).line("LALO'S");
    p.size(1, 1).line("BURGAS").normal().align(Align::Center);
    p.line("Av. Goycoechea 436 - Villa Allende");
    p.line("IG @lalos.burgas");
    p.separator('-');
    p.align(Align::Left);
    p.two_cols(&format!("Pedido #{:03}", order.ticket_number), &local_time(&order.created_at, "%d/%m/%Y %H:%M"));
    p.line(order_type_label(&order.order_type));
    if let Some(name) = &order.customer_name {
        p.line(&format!("Cliente: {name}"));
    }
    if let Some(hora) = &order.pickup_time {
        p.line(&format!("Retiro: {hora}"));
    }
    p.separator('-');

    for item in &order.items {
        p.two_cols(&format!("{}x {}", item.quantity, item.product_name), &money(item.subtotal));
        if item.quantity > 1 {
            p.line(&format!("   {} c/u", money(item.unit_price)));
        }
        if let Some(mods) = &item.modifications {
            p.indented(mods, 3);
        }
    }

    p.separator('-');
    p.size(1, 2).bold(true).two_cols("TOTAL", &money(order.total)).normal();
    match (&order.paid_at, &order.paid_method) {
        (Some(_), Some(m)) => p.two_cols("Pago", payment_label(m)),
        _ => p.two_cols("Pago", "Pendiente de cobro"),
    };
    if let Some(cash) = order.cash_received {
        p.two_cols("Recibido", &money(cash));
        if let Some(change) = order.change() {
            p.bold(true).two_cols("Vuelto", &money(change)).bold(false);
        }
    }
    p.separator('-');
    p.align(Align::Center).line("¡Gracias por elegirnos!");
    p.line("Comprobante no válido como factura");
    p.feed(4).cut();
    p.finish()
}

pub fn test_page(paper_mm: u8) -> Vec<u8> {
    let mut p = EscPos::new(paper_mm);
    let cols = p.cols;
    p.align(Align::Center).size(2, 2).bold(true).line("LALO'S POS").normal();
    p.align(Align::Center).line("Prueba de impresión");
    p.line(&format!("Papel {paper_mm} mm · {cols} columnas"));
    p.separator('=');
    p.align(Align::Left);
    p.line("Normal: áéíóú ñÑ ¿¡ °");
    p.bold(true).line("Negrita").bold(false);
    p.size(1, 2).line("Doble alto").normal();
    p.size(2, 1).line("Doble ancho").normal();
    p.reverse(true).line(" Invertido (notas de cocina) ").reverse(false);
    p.two_cols("Producto", "$14.000");
    p.separator('-');
    p.align(Align::Center).line("Si ves esto bien, ¡listo!");
    p.feed(4).cut();
    p.finish()
}

#[cfg(test)]
mod tests {
    use super::money;

    #[test]
    fn formats_money() {
        assert_eq!(money(14000.0), "$14.000");
        assert_eq!(money(1500.0), "$1.500");
        assert_eq!(money(999.0), "$999");
        assert_eq!(money(1234567.5), "$1.234.567,50");
    }
}
