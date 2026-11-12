# Lalo's POS — Caja, comandera, cocina y menú en vivo (Fase 2)

Tauri 2 (Rust) + React 18 + TypeScript + Tailwind · SQLite local · Supabase · ESC/POS

---

## 1. Estructura

```
pos/
├── index.html · package.json · vite.config.ts · tailwind.config.js · tsconfig.json
├── app-icon.png                 # fuente del ícono (reemplazala por el logo y corré `npm run tauri icon`)
├── supabase/migrations/
│   ├── 0001_init.sql            # la de la landing (carta + RLS de lectura) — si ya la corriste, no repetir
│   └── 0002_pos.sql             # personal (staff), permisos de escritura, RPC de pedidos y de precios
├── src/                         # ── Frontend (WebView) ──
│   ├── main.tsx · App.tsx · index.css
│   ├── lib/
│   │   ├── api.ts               # ÚNICA puerta al backend (invoke de Tauri)
│   │   ├── store.tsx            # estado global: conexión, carta, avisos
│   │   ├── types.ts · menu.ts · format.ts
│   ├── components/
│   │   ├── Layout.tsx           # barra lateral (Caja/Cocina/Menú/Config), estado online, F1–F4, F11
│   │   └── OptionsModal.tsx     # extras, "sin cebolla", notas
│   └── screens/
│       ├── PosScreen.tsx        # caja: catálogo + ticket + cobro + vuelto + reimpresión
│       ├── KitchenScreen.tsx    # KDS: Nuevos → Preparando → Listos, alertas por demora
│       ├── MenuAdminScreen.tsx  # productos, agotado, precios inline, ajuste % masivo, promos
│       └── SettingsScreen.tsx   # Supabase + login, impresora (USB/COM/IP), prueba
└── src-tauri/                   # ── Backend (Rust) ──
    ├── Cargo.toml · build.rs · tauri.conf.json
    ├── capabilities/main.json   # permisos mínimos del WebView
    ├── icons/
    └── src/
        ├── main.rs · lib.rs     # arranque, SQLite, registro de comandos
        ├── commands.rs          # todo lo que puede llamar el frontend
        ├── db.rs                # esquema SQLite (pedidos, config, copia del menú)
        ├── orders.rs            # alta de pedidos, numeración diaria, KDS, resumen de caja
        ├── supabase.rs          # Auth + PostgREST (tokens solo en Rust)
        ├── sync.rs              # sube pedidos pendientes y baja el menú cada minuto
        ├── state.rs · error.rs
        └── printer/
            ├── escpos.rs        # comandos ESC/POS (negrita, tamaños, corte, cajón, CP850)
            ├── tickets.rs       # comanda de cocina, ticket cliente, página de prueba
            ├── transport.rs     # envío de bytes crudos: USB (winspool RAW), COM, red :9100
            └── mod.rs
```

### Cómo funciona offline

| Acción | Sin internet |
|---|---|
| Cobrar, imprimir, KDS | ✅ Todo en SQLite local. Los pedidos se marcan "por sincronizar" y suben solos al volver. |
| Ver la carta | ✅ Usa la última copia descargada. |
| Editar carta / precios / promos | ❌ Necesita internet (escribe en Supabase para que la web lo vea al instante). |

### Seguridad

- El POS **no usa la `service_role`**. Inicia sesión con un usuario de Supabase Auth que
  figura en la tabla `staff`; las políticas RLS le dan permiso de escritura.
- El refresh token se guarda en el **Administrador de credenciales de Windows**, no en archivos.
- El WebView no ve tokens ni claves: todo pasa por comandos de Rust.
- Si roban la PC: Supabase → Authentication → cambiás la contraseña (o borrás el usuario) y listo.

---

## 2. Requisitos en la PC de desarrollo (Windows 10/11)

Se instalan **una sola vez**:

1. **Microsoft C++ Build Tools**
   Descargar "Build Tools for Visual Studio" → marcar **"Desktop development with C++"** → instalar.
2. **WebView2** — ya viene en Windows 10 (actualizado) y 11.
3. **Rust** — https://rustup.rs → `rustup-init.exe` → opciones por defecto (toolchain MSVC).
4. **Node.js 20 LTS** — https://nodejs.org
5. Verificar en una terminal nueva (PowerShell):
   ```powershell
   rustc --version
   cargo --version
   node --version
   ```

---

## 3. Supabase (una sola vez)

1. SQL Editor → ejecutar `supabase/migrations/0002_pos.sql`
   (si todavía no corriste la de la landing, primero `0001_init.sql`).
2. Authentication → Users → **Add user** → `caja@lalosburgas.com.ar` + contraseña → *Auto confirm*.
3. SQL Editor:
   ```sql
   insert into public.staff (user_id, name, role)
   select id, 'Caja', 'admin' from auth.users where email = 'caja@lalosburgas.com.ar';
   ```
4. Settings → API → copiar **Project URL** y **anon public key** (se cargan en el POS, paso 5).

---

## 4. Instalar y correr en modo desarrollo

```powershell
cd pos
npm install
npm run tauri dev
```

La primera vez Cargo baja y compila todas las dependencias de Rust: tarda **5 a 10 minutos**.
Después, unos segundos.

---

## 5. Primer uso

1. **F4 (Config) → Nube**: pegar URL + anon key → *Guardar conexión*.
2. Iniciar sesión con el usuario de caja. Se descarga la carta.
3. **Impresora**:
   - **USB**: instalá la impresora en Windows con su driver (o *Generic / Text Only*),
     elegila en la lista → *Imprimir prueba*.
   - **Serie**: elegí el puerto COM y la velocidad (casi siempre 9600).
   - **Red**: IP fija de la impresora, puerto 9100.
   - Elegí 58 u 80 mm y qué imprimir al cobrar.
4. **F1 (Caja)** y a vender. **F9** cobra.

### Atajos

| Tecla | Acción |
|---|---|
| F1 / F2 / F3 / F4 | Caja / Cocina / Menú / Configuración |
| F9 | Confirmar y cobrar |
| Ctrl+K o F6 | Buscar producto (Enter agrega si hay uno solo) |
| F11 | Pantalla completa |

---

## 6. Compilar el instalador `.exe`

```powershell
cd pos
npm run tauri build
```

Resultado:

```
src-tauri\target\release\lalos-pos.exe                                  ← ejecutable suelto
src-tauri\target\release\bundle\nsis\Lalos POS_0.1.0_x64-setup.exe      ← instalador (recomendado)
src-tauri\target\release\bundle\msi\Lalos POS_0.1.0_x64_es-ES.msi       ← instalador MSI
```

Instalá `…-setup.exe` en la PC de la caja. La base local queda en
`%APPDATA%\com.lalosburgas.pos\lalos-pos.db` (hacele backup de vez en cuando).

**Opcional:** precargar URL y anon key al compilar para no tipearlas en cada PC:

```powershell
$env:LALOS_SUPABASE_URL="https://xxxx.supabase.co"
$env:LALOS_SUPABASE_ANON_KEY="eyJ..."
npm run tauri build
```

(Solo la anon key: es pública. **Nunca** la service_role.)

### Ícono

Reemplazá `app-icon.png` (1024×1024) por el logo y corré `npm run tauri icon app-icon.png`.

### Windows SmartScreen

Sin certificado de firma, la primera vez Windows avisa "aplicación no reconocida" →
*Más información* → *Ejecutar de todas formas*. Para evitarlo hace falta un certificado
de firma de código (opcional).

---

## 7. Problemas comunes

| Síntoma | Solución |
|---|---|
| `link.exe not found` al compilar | Falta "Desktop development with C++" (paso 2.1). |
| "No se pudo abrir la impresora" | El nombre tiene que ser exacto al de *Impresoras y escáneres*. Tocá *Buscar*. |
| Imprime símbolos raros en vez de acentos | La impresora no está en PC850: probar otra tabla en `escpos.rs` (`ESC t n`). |
| No corta el papel | Tu modelo no tiene cortador o usa otro comando: cambiar `cut()` a `GS V 0`. |
| "Ese usuario no está habilitado en staff" | Falta el `insert into staff` del paso 3.3. |
| Pedidos "por sincronizar" que no bajan | Ver el error en Caja → historial; casi siempre es sesión vencida → volver a iniciar sesión. |
