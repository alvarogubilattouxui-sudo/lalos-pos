-- =====================================================================
-- Lalo's Burgas — esquema + RLS + Realtime + carta real
-- Ejecutar en Supabase → SQL Editor (o `supabase db push`).
--
-- Respecto del modelo original del brief:
--   * categories: + description, image_url
--   * products:   + featured
--   * NUEVO: option_groups / options / product_option_groups
--     (Extras con precio, Aderezos sin cargo, etc. — reutilizables entre productos)
--   * orders.payment_method acepta también 'qr'
--   * NOT NULL en flags/orden/fechas, trigger de updated_at, CHECKs de montos
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Carta ----------
create table if not exists public.categories (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique,
  description   text,
  image_url     text,
  display_order integer not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists public.products (
  id            uuid primary key default gen_random_uuid(),
  category_id   uuid references public.categories(id) on delete set null,
  name          text not null,
  description   text,
  price         numeric(10,2) not null check (price >= 0),
  image_url     text,
  available     boolean not null default true,
  featured      boolean not null default false,
  display_order integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists products_category_idx on public.products(category_id, display_order);

create table if not exists public.option_groups (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  min_selections integer not null default 0 check (min_selections >= 0),
  max_selections integer not null default 1 check (max_selections >= 1),
  display_order  integer not null default 0,
  created_at     timestamptz not null default now(),
  check (max_selections >= min_selections)
);

create table if not exists public.options (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.option_groups(id) on delete cascade,
  name          text not null,
  price         numeric(10,2) not null default 0 check (price >= 0),
  available     boolean not null default true,
  display_order integer not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists options_group_idx on public.options(group_id, display_order);

create table if not exists public.product_option_groups (
  product_id    uuid not null references public.products(id) on delete cascade,
  group_id      uuid not null references public.option_groups(id) on delete cascade,
  display_order integer not null default 0,
  primary key (product_id, group_id)
);

create table if not exists public.promotions (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  description    text,
  discount_type  text check (discount_type in ('percent', 'fixed', 'free_item')),
  discount_value numeric(10,2),
  valid_from     timestamptz,
  valid_until    timestamptz,
  image_url      text,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

-- ---------- Caja / KDS ----------
create table if not exists public.orders (
  id             uuid primary key default gen_random_uuid(),
  order_number   serial,
  customer_name  text,
  order_type     text not null default 'local' check (order_type in ('local', 'takeaway', 'delivery')),
  status         text not null default 'pending' check (status in ('pending', 'preparing', 'ready', 'delivered', 'cancelled')),
  total          numeric(10,2) not null check (total >= 0),
  payment_method text check (payment_method in ('cash', 'transfer', 'mercadopago', 'qr')),
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists orders_status_idx on public.orders(status, created_at desc);

create table if not exists public.order_items (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid references public.orders(id) on delete cascade,
  product_id    uuid references public.products(id) on delete set null,
  product_name  text not null,
  product_price numeric(10,2) not null,
  quantity      integer not null default 1 check (quantity > 0),
  modifications text,
  subtotal      numeric(10,2) not null,
  created_at    timestamptz not null default now()
);
create index if not exists order_items_order_idx on public.order_items(order_id);

-- ---------- updated_at ----------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at before update on public.products
  for each row execute function public.set_updated_at();

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

-- ---------- RLS ----------
alter table public.categories            enable row level security;
alter table public.products              enable row level security;
alter table public.option_groups         enable row level security;
alter table public.options               enable row level security;
alter table public.product_option_groups enable row level security;
alter table public.promotions            enable row level security;
alter table public.orders                enable row level security;
alter table public.order_items           enable row level security;

-- Landing (anon): solo LECTURA de la carta.
drop policy if exists "public read categories" on public.categories;
create policy "public read categories" on public.categories
  for select to anon, authenticated using (active = true);

-- Se leen también los no disponibles para mostrarlos como "Agotado".
drop policy if exists "public read products" on public.products;
create policy "public read products" on public.products
  for select to anon, authenticated using (true);

drop policy if exists "public read option_groups" on public.option_groups;
create policy "public read option_groups" on public.option_groups
  for select to anon, authenticated using (true);

drop policy if exists "public read options" on public.options;
create policy "public read options" on public.options
  for select to anon, authenticated using (true);

drop policy if exists "public read product_option_groups" on public.product_option_groups;
create policy "public read product_option_groups" on public.product_option_groups
  for select to anon, authenticated using (true);

drop policy if exists "public read promotions" on public.promotions;
create policy "public read promotions" on public.promotions
  for select to anon, authenticated
  using (active = true and (valid_until is null or valid_until > now()));

-- orders / order_items: sin políticas para anon → acceso denegado.
-- El POS escribe con service_role desde el backend Rust (bypassea RLS).

-- ---------- Realtime ----------
do $$
declare t text;
begin
  foreach t in array array['categories','products','option_groups','options','product_option_groups','promotions'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- =====================================================================
-- SEED: carta real (frambuesa.app/order/lalo-s-burgas, 11/11/2026)
-- Idempotente: se puede correr más de una vez.
-- =====================================================================

do $$
declare
  img constant text := 'https://qgzcrhxcymowvztxutom.supabase.co/storage/v1/object/public/public-assets/tenants/5d6be33b-4601-45f5-b9b5-e4dd5c8cc82c/branches/2f7fa3f8-dc46-4c82-89c3-6cab6010bd42/';
  g_extras uuid;
  g_aderezos uuid;
begin
  if exists (select 1 from public.products) then
    raise notice 'La carta ya tiene productos: seed omitido.';
    return;
  end if;

  -- Categorías
  insert into public.categories (name, slug, description, image_url, display_order) values
    ('Burgas Dobles',       'burgas-dobles',       '2 medallones de carne con toppings. Incluyen papas.', img || 'categories/e8a64f0b-72c2-403a-9bf0-401ec990bb0e/square-1787242425625-2e228fea.webp', 1),
    ('Burgas Simples',      'burgas-simples',      '1 medallón de carne con toppings. Incluyen papas.',   img || 'categories/8e94224c-ba5c-44f7-9bf7-ab230e7a2ed6/square-1787242417014-82127830.webp', 2),
    ('Burgas Triples',      'burgas-triples',      '3 medallones de carne con toppings. Incluyen papas.', img || 'categories/f5e52e96-b863-4035-bedc-8a1d7a908b0f/square-1787242433337-0a93b579.webp', 3),
    ('Burgas Individuales', 'burgas-individuales', 'Hamburguesas con toppings. No incluyen papas.',       img || 'categories/ade4d1c9-dd2c-4b1d-9c37-4149c0e2ea5f/square-1787242442465-a3ce020a.webp', 4),
    ('Extras',              'extras',              'El acompañamiento perfecto para tu pedido.',         img || 'categories/634ae831-eab2-4a06-95e3-ab0c5a030f0a/square-1787242450981-8a79f485.webp', 5)
  on conflict (slug) do nothing;

  -- Grupos de opciones
  insert into public.option_groups (name, min_selections, max_selections, display_order)
    values ('Extras', 0, 8, 1) returning id into g_extras;
  insert into public.option_groups (name, min_selections, max_selections, display_order)
    values ('Aderezos', 0, 1, 2) returning id into g_aderezos;

  insert into public.options (group_id, name, price, display_order) values
    (g_extras, 'Medallón', 3000, 1),
    (g_extras, 'Tomate', 1000, 2),
    (g_extras, 'Cebolla picada', 1000, 3),
    (g_extras, 'Cebolla Crispy', 1000, 4),
    (g_aderezos, 'Ketchup', 0, 1),
    (g_aderezos, 'Mayonesa', 0, 2),
    (g_aderezos, 'Mostaza', 0, 3),
    (g_aderezos, 'Salsa Lalo''s', 0, 4);

  -- Productos
  insert into public.products (category_id, name, description, price, image_url, featured, display_order)
  select c.id, p.name, p.description, p.price, case when p.image is null then null else img || p.image end, p.featured, p.ord
  from (values
    -- Dobles
    ('burgas-dobles', 'La Lalo''s Crispy doble + papas', 'Pan de papa, 2 blend de 100 g, queso cheddar americano, Cebolla Crispy y Salsa Lalo''s. Incluye papas.', 14000, 'products/cec1d4a5-2ba9-4f05-8cca-920dd580f6f6/1787096956281-b7ffef2a.webp', true, 1),
    ('burgas-dobles', 'La Clásica doble + papas', 'Pan de papa, 2 blend de 100 g, queso cheddar americano, cebolla blanca cortada en brunoise, ketchup. Incluye papas.', 14000, 'products/0b154f81-cb97-4638-bf01-ece566ccf80c/1788569770398-4019f57b.webp', false, 2),
    ('burgas-dobles', 'La Doble M doble + papas', 'Pan de papa, 2 blend de 100 g, queso cheddar americano, rodajas de tomate, mayonesa. Incluye papas.', 14000, 'products/d759b3a9-a8cb-4bbc-a20c-abf7a5ec4b19/1787096927871-0f32d436.webp', false, 3),
    ('burgas-dobles', 'Doble queso + papas', 'Pan de papa, 2 blend de 100 g, queso cheddar americano. Incluye papas.', 14000, 'products/_pending/1789769947301-1c4195c9.webp', false, 4),
    ('burgas-dobles', 'La Veggie doble + papas', 'Pan de papa, queso cheddar americano, doble medallón de seitán, rodajas de tomate, mayonesa. Incluye papas.', 14000, 'products/e6c9c5d0-b3a2-44d1-a9f3-9f951289d07c/1787160549141-9d6d2a68.webp', false, 5),
    -- Simples
    ('burgas-simples', 'La Lalo''s Crispy simple + papas', 'Pan de papa, blend de 100 g, queso cheddar americano, Cebolla Crispy y Salsa Lalo''s. Incluye papas.', 12000, 'products/1cb9f5c6-9e2d-4317-a4e8-1d6eea5e7d2a/1787096942533-bf3f5089.webp', false, 1),
    ('burgas-simples', 'La Clásica simple + papas', 'Pan de papa, blend de 100 g, queso cheddar americano, cebolla blanca cortada en brunoise, ketchup. Incluye papas.', 12000, 'products/_pending/1787096848156-ded0d43f.webp', false, 2),
    ('burgas-simples', 'La Doble M simple + papas', 'Pan de papa, blend de 100 g, queso cheddar americano, rodajas de tomate, mayonesa. Incluye papas.', 12000, 'products/3062f94d-03d9-4783-98f5-df4ddba2c30f/1787096914168-b3eac712.webp', false, 3),
    ('burgas-simples', 'La Veggie simple + papas', 'Pan de papa, queso cheddar americano, medallón de seitán, rodajas de tomate, mayonesa. Incluye papas.', 12000, 'products/e67d13b3-be90-4d51-a6cf-569090de3be2/1787160498614-2a7c6509.webp', false, 4),
    -- Triples
    ('burgas-triples', 'La Lalo''s Crispy triple + papas', 'Pan de papa, 3 blend de 100 g, queso cheddar americano, Cebolla Crispy y Salsa Lalo''s. Incluye papas.', 16000, 'products/cc5e36f8-186e-44d3-ab99-7f1d1e2fe6b6/1787153795916-77631115.webp', false, 1),
    ('burgas-triples', 'La Clásica triple + papas', 'Pan de papa, 3 blend de 100 g, queso cheddar americano, cebolla blanca cortada en brunoise, ketchup. Incluye papas.', 16000, 'products/814cbe91-ace5-4b56-8d9e-1894be66a474/1787153557139-d9cf74ec.webp', false, 2),
    ('burgas-triples', 'La Doble M triple + papas', 'Pan de papa, 3 blend de 100 g, queso cheddar americano, rodajas de tomate, mayonesa. Incluye papas.', 16000, 'products/2c18786f-bfb1-4275-b22b-e0343a761f26/1787153808101-39303854.webp', false, 3),
    ('burgas-triples', 'La Veggie triple + papas', 'Pan de papa, queso cheddar americano, triple medallón de seitán, rodajas de tomate, mayonesa. Incluye papas.', 16000, 'products/59e5c283-46f7-4193-b985-df82c88829e5/1787160668469-7911a47a.webp', false, 4),
    -- Individuales (sin papas)
    ('burgas-individuales', 'Lalo''s Crispy doble', null, 12000, 'products/_pending/1787171002313-58ee1e99.webp', false, 1),
    ('burgas-individuales', 'Lalo''s Crispy simple', null, 10000, 'products/_pending/1787170932452-97785e5f.webp', false, 2),
    ('burgas-individuales', 'La Clásica doble', null, 12000, 'products/_pending/1787170410230-425c87c3.webp', false, 3),
    ('burgas-individuales', 'La Clásica simple', null, 10000, 'products/_pending/1787170322443-43fc88e0.webp', false, 4),
    ('burgas-individuales', 'La Doble M doble', null, 12000, 'products/_pending/1787170726377-38615721.webp', false, 5),
    ('burgas-individuales', 'La Doble M simple', null, 10000, 'products/_pending/1787170661360-692e981a.webp', false, 6),
    ('burgas-individuales', 'La Veggie doble', null, 12000, 'products/_pending/1787171238840-066c8703.webp', false, 7),
    ('burgas-individuales', 'La Veggie simple', null, 10000, 'products/_pending/1787171132670-c65179be.webp', false, 8),
    -- Extras
    ('extras', 'Porción de papas', null, 4000, 'products/89ee0f37-34fb-4ebb-80f3-52e6d8d2dc32/1787159965064-24d20091.webp', false, 1),
    ('extras', 'Salsa Lalo''s', 'Potecito de Salsa Lalo''s, ideal para untar tus papas.', 1500, 'products/a2c413b5-7a80-4a69-a91a-0cbb257e4235/1787159135540-929bdf29.webp', false, 2)
  ) as p(cat, name, description, price, image, featured, ord)
  join public.categories c on c.slug = p.cat;

  -- Opciones por producto: todas las burgers llevan "Extras", salvo "Doble queso" que lleva "Aderezos".
  insert into public.product_option_groups (product_id, group_id, display_order)
  select pr.id, case when pr.name = 'Doble queso + papas' then g_aderezos else g_extras end, 1
  from public.products pr
  join public.categories c on c.id = pr.category_id
  where c.slug <> 'extras';
end $$;
