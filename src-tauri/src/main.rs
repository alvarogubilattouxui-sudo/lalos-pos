// En release no abre una consola negra detrás de la ventana en Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    lalos_pos_lib::run()
}
