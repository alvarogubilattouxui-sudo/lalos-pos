mod commands;
mod db;
mod error;
mod orders;
mod printer;
mod state;
mod supabase;
mod sync;

use tauri::Manager;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // %APPDATA%\com.lalosburgas.pos\lalos-pos.db
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = db::open(&dir.join("lalos-pos.db"))?;
            app.manage(AppState::new(conn));
            sync::start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_status,
            commands::save_supabase_config,
            commands::login,
            commands::logout,
            commands::sync_now,
            commands::get_menu,
            commands::get_store_state,
            commands::admin_insert,
            commands::admin_update,
            commands::admin_delete,
            commands::admin_set_product_groups,
            commands::admin_adjust_prices,
            commands::create_order,
            commands::list_kitchen_orders,
            commands::list_today_orders,
            commands::day_summary,
            commands::day_products,
            commands::get_commissions,
            commands::save_commissions,
            commands::cash_status,
            commands::cash_open,
            commands::cash_close,
            commands::cash_add_movement,
            commands::cash_session_movements,
            commands::update_order_status,
            commands::mark_order_paid,
            commands::list_printers,
            commands::get_printer_config,
            commands::save_printer_config,
            commands::print_raw,
            commands::print_test,
            commands::reprint_order,
        ])
        .run(tauri::generate_context!())
        .expect("no se pudo iniciar Lalo's POS");
}
