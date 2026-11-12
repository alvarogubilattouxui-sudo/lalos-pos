-- =====================================================================
-- Lalo's Burgas — Fase 2 (POS)
-- Ejecutar DESPUÉS de 0001_init.sql (la de la landing).
--
-- Seguridad: el POS NO usa la service_role. Se loguea con un usuario de
-- Supabase Auth que tiene que estar en la tabla `staff`. Las políticas RLS
-- de abajo le dan escritura sobre la carta y los pedidos solo a ese personal.
-- =====================================================================

-- ---------- Personal ----------
create table if not exists public.staff (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  name       text,
  role       text not null default 'cashier' check (role in ('admin', 'cashier')),
  created_at timestamptz not null default now()
);
alter table public.staff enable row level security;

drop policy if exists "staff read self" on public.staff;
create policy "staff read self" on public.staff
  for select to authenticated using (user_id = auth.uid());

-- security definer: puede leer staff aunque la RLS solo deje ver la propia fila
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid());
$$;
revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to authenticated;

-- ---------- Pedidos del POS ----------
alter table public.orders add column if not exists ticket_number integer;
alter table public.orders add column if not exists business_day  date;
alter table public.orders add column if not exists cash_received numeric(10,2);
alter table public.orders add column if not exists source        text not null default 'pos'
  check (source in ('pos', 'web'));

alter table public.orders drop constraint if exists orders_payment_method_check;
alter table public.orders add constraint orders_payment_method_check
  check (payment_method in ('cash', 'card', 'qr', 'transfer', 'mercadopago'));

create index if not exists orders_day_idx on public.orders(business_day, ticket_number);

-- ---------- Permisos del personal (se suman a los de lectura pública de la landing) ----------
do $$
declare t text;
begin
  foreach t in array array[
    'categories', 'products', 'option_groups', 'options', 'product_option_groups',
    'promotions', 'orders', 'order_items'
  ] loop
    execute format('drop policy if exists "staff full access" on public.%I', t);
    execute format(
      'create policy "staff full access" on public.%I for all to authenticated
         using (public.is_staff()) with check (public.is_staff())', t);
  end loop;
end $$;

-- ---------- RPC: alta/actualización idempotente de un pedido del POS ----------
-- El POS genera el UUID localmente (funciona offline) y lo sube cuando hay internet.
-- Reintentar no duplica: si ya existe, actualiza estado/datos y reemplaza los ítems.
create or replace function public.pos_upsert_order(p jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid := (p->>'id')::uuid;
begin
  if not public.is_staff() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  insert into public.orders (
    id, ticket_number, business_day, customer_name, order_type, status, total,
    payment_method, cash_received, notes, source, created_at
  ) values (
    v_id,
    (p->>'ticket_number')::int,
    (p->>'business_day')::date,
    p->>'customer_name',
    p->>'order_type',
    p->>'status',
    (p->>'total')::numeric,
    p->>'payment_method',
    (p->>'cash_received')::numeric,
    p->>'notes',
    'pos',
    (p->>'created_at')::timestamptz
  )
  on conflict (id) do update set
    status         = excluded.status,
    customer_name  = excluded.customer_name,
    notes          = excluded.notes,
    total          = excluded.total,
    payment_method = excluded.payment_method,
    cash_received  = excluded.cash_received;

  delete from public.order_items where order_id = v_id;

  insert into public.order_items (id, order_id, product_id, product_name, product_price, quantity, modifications, subtotal)
  select
    (i->>'id')::uuid,
    v_id,
    -- si el producto ya no existe en la nube, se guarda igual (sin vínculo)
    (select pr.id from public.products pr where pr.id::text = i->>'product_id'),
    i->>'product_name',
    (i->>'product_price')::numeric,
    (i->>'quantity')::int,
    i->>'modifications',
    (i->>'subtotal')::numeric
  from jsonb_array_elements(p->'items') as i;
end $$;

grant execute on function public.pos_upsert_order(jsonb) to authenticated;

-- ---------- RPC: ajuste masivo de precios ----------
-- Ej: select adjust_prices(8, null, 100);  → +8% a toda la carta, redondeado a $100
create or replace function public.adjust_prices(
  p_percent  numeric,
  p_category uuid    default null,
  p_round_to numeric default 100
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_round numeric := greatest(coalesce(p_round_to, 1), 1);
  v_count integer;
begin
  if not public.is_staff() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_percent <= -90 or p_percent > 300 then
    raise exception 'Porcentaje fuera de rango';
  end if;

  update public.products
     set price = greatest(0, round(price * (1 + p_percent / 100) / v_round) * v_round)
   where p_category is null or category_id = p_category;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

grant execute on function public.adjust_prices(numeric, uuid, numeric) to authenticated;

-- ---------- Realtime de pedidos (para un futuro KDS en otra pantalla / pedidos web) ----------
do $$
begin
  begin alter publication supabase_realtime add table public.orders;      exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.order_items; exception when duplicate_object then null; end;
end $$;

-- =====================================================================
-- ALTA DEL USUARIO DE CAJA (una sola vez):
-- 1) Supabase → Authentication → Users → "Add user" → email + contraseña
--    (ej: caja@lalosburgas.com.ar), marcar "Auto confirm".
-- 2) Ejecutar, reemplazando el email:
--
--   insert into public.staff (user_id, name, role)
--   select id, 'Caja', 'admin' from auth.users where email = 'caja@lalosburgas.com.ar';
-- =====================================================================
