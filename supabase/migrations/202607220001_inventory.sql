-- SECURITY WARNING: Version one is a shared, anonymous, single-tenant client.
-- Replace every shared_v1_anon_* policy with authenticated tenant/role policies
-- before storing sensitive data or deploying this schema for multiple tenants.

create extension if not exists pgcrypto;

create sequence public.inventory_document_number_seq;

create table public.shoe_models (
  id uuid primary key default gen_random_uuid(),
  name text not null constraint shoe_models_name_not_blank check (name = btrim(name) and name <> ''),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index shoe_models_name_lower_key on public.shoe_models (lower(name));

create table public.colors (
  id uuid primary key default gen_random_uuid(),
  name text not null constraint colors_name_not_blank check (name = btrim(name) and name <> ''),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index colors_name_lower_key on public.colors (lower(name));

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references public.shoe_models (id) on delete restrict,
  color_id uuid not null references public.colors (id) on delete restrict,
  size numeric(4,1) not null constraint product_variants_size_positive check (size > 0),
  low_stock_threshold integer not null default 3
    constraint product_variants_low_stock_threshold_nonnegative check (low_stock_threshold >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_variants_model_color_size_key unique (model_id, color_id, size)
);

create table public.inventory_balances (
  variant_id uuid primary key references public.product_variants (id) on delete restrict,
  quantity integer not null default 0
    constraint inventory_balances_quantity_nonnegative check (quantity >= 0),
  updated_at timestamptz not null default now()
);

create table public.stock_documents (
  id uuid primary key default gen_random_uuid(),
  document_number text not null unique,
  movement_type text not null constraint stock_documents_movement_type_valid
    check (movement_type in ('RECEIPT', 'SALE', 'DAMAGE', 'ADJUSTMENT', 'EXCHANGE')),
  effective_date date not null,
  reference text not null default '',
  note text not null default '',
  created_at timestamptz not null default now()
);

create index stock_documents_effective_date_idx
  on public.stock_documents (effective_date desc, created_at desc);
create index stock_documents_movement_type_idx
  on public.stock_documents (movement_type, effective_date desc);

create table public.stock_document_lines (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.stock_documents (id) on delete restrict,
  variant_id uuid not null references public.product_variants (id) on delete restrict,
  line_number integer not null constraint stock_document_lines_line_number_positive check (line_number > 0),
  delta integer not null constraint stock_document_lines_delta_nonzero check (delta <> 0),
  exchange_section text constraint stock_document_lines_exchange_section_valid
    check (exchange_section is null or exchange_section in ('RETURNED', 'REPLACEMENT')),
  note text,
  created_at timestamptz not null default now(),
  constraint stock_document_lines_document_line_key unique (document_id, line_number),
  constraint stock_document_lines_exchange_delta_valid check (
    exchange_section is null
    or (exchange_section = 'RETURNED' and delta > 0)
    or (exchange_section = 'REPLACEMENT' and delta < 0)
  )
);

create index stock_document_lines_variant_idx
  on public.stock_document_lines (variant_id, document_id);

create or replace function public.set_inventory_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger shoe_models_set_updated_at
before update on public.shoe_models
for each row execute function public.set_inventory_updated_at();

create trigger colors_set_updated_at
before update on public.colors
for each row execute function public.set_inventory_updated_at();

create trigger product_variants_set_updated_at
before update on public.product_variants
for each row execute function public.set_inventory_updated_at();

create trigger inventory_balances_set_updated_at
before update on public.inventory_balances
for each row execute function public.set_inventory_updated_at();

create or replace function public.validate_stock_document_line()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  document_movement_type text;
begin
  select movement_type
    into document_movement_type
    from public.stock_documents
    where id = new.document_id;

  if document_movement_type = 'EXCHANGE' then
    if new.exchange_section is null then
      raise exception using errcode = '23514', message = 'EXCHANGE_SECTION_REQUIRED';
    end if;
  elsif new.exchange_section is not null then
    raise exception using errcode = '23514', message = 'EXCHANGE_SECTION_NOT_ALLOWED';
  end if;

  if (document_movement_type = 'RECEIPT' and new.delta < 0)
    or (document_movement_type in ('SALE', 'DAMAGE') and new.delta > 0) then
    raise exception using errcode = '23514', message = 'INVALID_MOVEMENT_DELTA';
  end if;

  return new;
end;
$$;

create trigger stock_document_lines_validate_movement
before insert or update on public.stock_document_lines
for each row execute function public.validate_stock_document_line();

create or replace function public.post_stock_document(command jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  movement text;
  effective_on date;
  new_document_id uuid := gen_random_uuid();
  next_document_sequence bigint;
  new_document_number text;
  line jsonb;
  line_variant_id uuid;
  line_variant_text text;
  line_quantity_numeric numeric;
  line_size numeric;
  has_returned boolean := false;
  has_replacement boolean := false;
begin
  if command is null or jsonb_typeof(command) is distinct from 'object' then
    raise exception using errcode = 'P0001', message = 'INVALID_DOCUMENT';
  end if;

  if jsonb_typeof(command -> 'type') is distinct from 'string'
    or command ->> 'type' not in ('RECEIPT', 'SALE', 'DAMAGE', 'ADJUSTMENT', 'EXCHANGE') then
    raise exception using errcode = 'P0001', message = 'INVALID_DOCUMENT';
  end if;
  movement := command ->> 'type';

  if jsonb_typeof(command -> 'effectiveDate') is distinct from 'string'
    or command ->> 'effectiveDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_DOCUMENT';
  end if;
  begin
    effective_on := (command ->> 'effectiveDate')::date;
  exception when others then
    raise exception using errcode = 'P0001', message = 'INVALID_DOCUMENT';
  end;
  if to_char(effective_on, 'YYYY-MM-DD') <> command ->> 'effectiveDate' then
    raise exception using errcode = 'P0001', message = 'INVALID_DOCUMENT';
  end if;

  if (command ? 'reference' and jsonb_typeof(command -> 'reference') not in ('string', 'null'))
    or (command ? 'note' and jsonb_typeof(command -> 'note') not in ('string', 'null'))
    or jsonb_typeof(command -> 'lines') is distinct from 'array' then
    raise exception using errcode = 'P0001', message = 'INVALID_DOCUMENT';
  end if;
  if jsonb_array_length(command -> 'lines') = 0 then
    raise exception using errcode = 'P0001', message = 'INVALID_DOCUMENT';
  end if;

  for line in select value from jsonb_array_elements(command -> 'lines')
  loop
    if jsonb_typeof(line) is distinct from 'object'
      or jsonb_typeof(line -> 'variantId') is distinct from 'string'
      or jsonb_typeof(line -> 'size') is distinct from 'number'
      or jsonb_typeof(line -> 'quantity') is distinct from 'number'
      or (line ? 'note' and jsonb_typeof(line -> 'note') not in ('string', 'null')) then
      raise exception using errcode = 'P0001', message = 'INVALID_DOCUMENT';
    end if;

    line_variant_text := line ->> 'variantId';
    if line_variant_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using errcode = 'P0001', message = 'VARIANT_NOT_FOUND';
    end if;
    line_variant_id := line_variant_text::uuid;

    begin
      line_quantity_numeric := (line ->> 'quantity')::numeric;
      line_size := (line ->> 'size')::numeric;
    exception when others then
      raise exception using errcode = 'P0001', message = 'INVALID_DOCUMENT';
    end;
    if line_quantity_numeric < 1
      or line_quantity_numeric <> trunc(line_quantity_numeric)
      or line_quantity_numeric > 2147483647
      or line_size <= 0 then
      raise exception using errcode = 'P0001', message = 'INVALID_DOCUMENT';
    end if;
    if not exists (
      select 1
      from public.product_variants variant
      where variant.id = line_variant_id and variant.size = line_size
    ) then
      raise exception using errcode = 'P0001', message = 'VARIANT_NOT_FOUND';
    end if;

    if movement = 'ADJUSTMENT' then
      if jsonb_typeof(line -> 'direction') is distinct from 'string'
        or line ->> 'direction' not in ('IN', 'OUT')
        or line ? 'section' then
        raise exception using errcode = 'P0001', message = 'INVALID_DOCUMENT';
      end if;
    elsif movement = 'EXCHANGE' then
      if jsonb_typeof(line -> 'section') is distinct from 'string'
        or line ->> 'section' not in ('RETURNED', 'REPLACEMENT')
        or line ? 'direction' then
        raise exception using errcode = 'P0001', message = 'INVALID_DOCUMENT';
      end if;
      has_returned := has_returned or line ->> 'section' = 'RETURNED';
      has_replacement := has_replacement or line ->> 'section' = 'REPLACEMENT';
    elsif line ? 'direction' or line ? 'section' then
      raise exception using errcode = 'P0001', message = 'INVALID_DOCUMENT';
    end if;
  end loop;

  if movement = 'EXCHANGE' and (not has_returned or not has_replacement) then
    raise exception using errcode = 'P0001', message = 'INVALID_DOCUMENT';
  end if;

  -- Materialize missing zero balances in the same deterministic order used below.
  -- These inserts roll back with the function if any projected balance is invalid.
  with parsed_lines as (
    select (item ->> 'variantId')::uuid as variant_id
    from jsonb_array_elements(command -> 'lines') as source(item)
  )
  insert into public.inventory_balances (variant_id, quantity)
  select distinct variant_id, 0
  from parsed_lines
  order by variant_id
  on conflict (variant_id) do nothing;

  -- Every affected balance exists now. Sorting before FOR UPDATE gives concurrent
  -- documents the same lock order and prevents cross-variant deadlocks.
  perform balance.variant_id
  from public.inventory_balances balance
  join (
    select distinct (item ->> 'variantId')::uuid as variant_id
    from jsonb_array_elements(command -> 'lines') as source(item)
  ) affected using (variant_id)
  order by balance.variant_id
  for update of balance;

  if exists (
    with parsed_lines as (
      select
        (item ->> 'variantId')::uuid as variant_id,
        case
          when movement = 'RECEIPT' then (item ->> 'quantity')::integer
          when movement in ('SALE', 'DAMAGE') then -(item ->> 'quantity')::integer
          when movement = 'ADJUSTMENT' and item ->> 'direction' = 'IN' then (item ->> 'quantity')::integer
          when movement = 'ADJUSTMENT' then -(item ->> 'quantity')::integer
          when item ->> 'section' = 'RETURNED' then (item ->> 'quantity')::integer
          else -(item ->> 'quantity')::integer
        end as delta
      from jsonb_array_elements(command -> 'lines') as source(item)
    ), aggregated_deltas as (
      select variant_id, sum(delta) as delta
      from parsed_lines
      group by variant_id
    )
    select 1
    from aggregated_deltas aggregate
    join public.inventory_balances balance using (variant_id)
    where balance.quantity + aggregate.delta < 0
  ) then
    raise exception using errcode = 'P0001', message = 'INSUFFICIENT_STOCK';
  end if;

  if exists (
    with parsed_lines as (
      select
        (item ->> 'variantId')::uuid as variant_id,
        case
          when movement = 'RECEIPT' then (item ->> 'quantity')::integer
          when movement in ('SALE', 'DAMAGE') then -(item ->> 'quantity')::integer
          when movement = 'ADJUSTMENT' and item ->> 'direction' = 'IN' then (item ->> 'quantity')::integer
          when movement = 'ADJUSTMENT' then -(item ->> 'quantity')::integer
          when item ->> 'section' = 'RETURNED' then (item ->> 'quantity')::integer
          else -(item ->> 'quantity')::integer
        end as delta
      from jsonb_array_elements(command -> 'lines') as source(item)
    ), aggregated_deltas as (
      select variant_id, sum(delta) as delta
      from parsed_lines
      group by variant_id
    )
    select 1
    from aggregated_deltas aggregate
    join public.inventory_balances balance using (variant_id)
    where balance.quantity::bigint + aggregate.delta > 2147483647
  ) then
    raise exception using errcode = 'P0001', message = 'INVALID_DOCUMENT';
  end if;

  next_document_sequence := nextval('public.inventory_document_number_seq');
  new_document_number := format(
    'STK-%s-%s',
    to_char(effective_on, 'YYYYMMDD'),
    lpad(next_document_sequence::text, greatest(6, length(next_document_sequence::text)), '0')
  );

  insert into public.stock_documents (
    id, document_number, movement_type, effective_date, reference, note
  ) values (
    new_document_id,
    new_document_number,
    movement,
    effective_on,
    coalesce(command ->> 'reference', ''),
    coalesce(command ->> 'note', '')
  );

  insert into public.stock_document_lines (
    document_id, variant_id, line_number, delta, exchange_section, note
  )
  select
    new_document_id,
    (item ->> 'variantId')::uuid,
    ordinality::integer,
    case
      when movement = 'RECEIPT' then (item ->> 'quantity')::integer
      when movement in ('SALE', 'DAMAGE') then -(item ->> 'quantity')::integer
      when movement = 'ADJUSTMENT' and item ->> 'direction' = 'IN' then (item ->> 'quantity')::integer
      when movement = 'ADJUSTMENT' then -(item ->> 'quantity')::integer
      when item ->> 'section' = 'RETURNED' then (item ->> 'quantity')::integer
      else -(item ->> 'quantity')::integer
    end,
    case when movement = 'EXCHANGE' then item ->> 'section' else null end,
    nullif(item ->> 'note', '')
  from jsonb_array_elements(command -> 'lines') with ordinality as source(item, ordinality);

  -- Use each locked row's absolute projected quantity so ON CONFLICT never tries
  -- to insert a negative delta into the non-negative balance column.
  with parsed_lines as (
    select
      (item ->> 'variantId')::uuid as variant_id,
      case
        when movement = 'RECEIPT' then (item ->> 'quantity')::integer
        when movement in ('SALE', 'DAMAGE') then -(item ->> 'quantity')::integer
        when movement = 'ADJUSTMENT' and item ->> 'direction' = 'IN' then (item ->> 'quantity')::integer
        when movement = 'ADJUSTMENT' then -(item ->> 'quantity')::integer
        when item ->> 'section' = 'RETURNED' then (item ->> 'quantity')::integer
        else -(item ->> 'quantity')::integer
      end as delta
    from jsonb_array_elements(command -> 'lines') as source(item)
  ), aggregated_deltas as (
    select variant_id, sum(delta) as delta
    from parsed_lines
    group by variant_id
  ), projected_balances as (
    select aggregate.variant_id, (balance.quantity::bigint + aggregate.delta)::integer as quantity
    from aggregated_deltas aggregate
    join public.inventory_balances balance using (variant_id)
  )
  insert into public.inventory_balances (variant_id, quantity)
  select variant_id, quantity
  from projected_balances
  order by variant_id
  on conflict (variant_id) do update
    set quantity = excluded.quantity,
        updated_at = now();

  return new_document_id;
end;
$$;

alter table public.shoe_models enable row level security;
alter table public.colors enable row level security;
alter table public.product_variants enable row level security;
alter table public.inventory_balances enable row level security;
alter table public.stock_documents enable row level security;
alter table public.stock_document_lines enable row level security;

create policy shared_v1_anon_read_shoe_models on public.shoe_models for select to anon using (true);
create policy shared_v1_anon_insert_shoe_models on public.shoe_models for insert to anon with check (true);
create policy shared_v1_anon_update_shoe_models on public.shoe_models for update to anon using (true) with check (true);
create policy shared_v1_anon_read_colors on public.colors for select to anon using (true);
create policy shared_v1_anon_insert_colors on public.colors for insert to anon with check (true);
create policy shared_v1_anon_update_colors on public.colors for update to anon using (true) with check (true);
create policy shared_v1_anon_read_product_variants on public.product_variants for select to anon using (true);
create policy shared_v1_anon_update_product_variants on public.product_variants for update to anon using (true) with check (true);
create policy shared_v1_anon_read_inventory_balances on public.inventory_balances for select to anon using (true);
create policy shared_v1_anon_insert_inventory_balances on public.inventory_balances for insert to anon with check (true);
create policy shared_v1_anon_update_inventory_balances on public.inventory_balances for update to anon using (true) with check (true);
create policy shared_v1_anon_read_stock_documents on public.stock_documents for select to anon using (true);
create policy shared_v1_anon_insert_stock_documents on public.stock_documents for insert to anon with check (true);
create policy shared_v1_anon_read_stock_document_lines on public.stock_document_lines for select to anon using (true);
create policy shared_v1_anon_insert_stock_document_lines on public.stock_document_lines for insert to anon with check (true);

comment on policy shared_v1_anon_read_shoe_models on public.shoe_models is
  'WARNING: shared anonymous v1 access; replace with authenticated tenant policies before sensitive or multi-tenant use.';
comment on policy shared_v1_anon_insert_shoe_models on public.shoe_models is
  'WARNING: shared anonymous v1 access; replace with authenticated tenant policies before sensitive or multi-tenant use.';
comment on policy shared_v1_anon_update_shoe_models on public.shoe_models is
  'WARNING: shared anonymous v1 access; replace with authenticated tenant policies before sensitive or multi-tenant use.';
comment on policy shared_v1_anon_read_colors on public.colors is
  'WARNING: shared anonymous v1 access; replace with authenticated tenant policies before sensitive or multi-tenant use.';
comment on policy shared_v1_anon_insert_colors on public.colors is
  'WARNING: shared anonymous v1 access; replace with authenticated tenant policies before sensitive or multi-tenant use.';
comment on policy shared_v1_anon_update_colors on public.colors is
  'WARNING: shared anonymous v1 access; replace with authenticated tenant policies before sensitive or multi-tenant use.';
comment on policy shared_v1_anon_read_product_variants on public.product_variants is
  'WARNING: shared anonymous v1 access; replace with authenticated tenant policies before sensitive or multi-tenant use.';
comment on policy shared_v1_anon_update_product_variants on public.product_variants is
  'WARNING: shared anonymous v1 access; replace with authenticated tenant policies before sensitive or multi-tenant use.';
comment on policy shared_v1_anon_read_inventory_balances on public.inventory_balances is
  'WARNING: shared anonymous v1 access; replace with authenticated tenant policies before sensitive or multi-tenant use.';
comment on policy shared_v1_anon_insert_inventory_balances on public.inventory_balances is
  'WARNING: shared anonymous v1 access; replace with authenticated tenant policies before sensitive or multi-tenant use.';
comment on policy shared_v1_anon_update_inventory_balances on public.inventory_balances is
  'WARNING: shared anonymous v1 access; replace with authenticated tenant policies before sensitive or multi-tenant use.';
comment on policy shared_v1_anon_read_stock_documents on public.stock_documents is
  'WARNING: shared anonymous v1 access; replace with authenticated tenant policies before sensitive or multi-tenant use.';
comment on policy shared_v1_anon_insert_stock_documents on public.stock_documents is
  'WARNING: shared anonymous v1 access; replace with authenticated tenant policies before sensitive or multi-tenant use.';
comment on policy shared_v1_anon_read_stock_document_lines on public.stock_document_lines is
  'WARNING: shared anonymous v1 access; replace with authenticated tenant policies before sensitive or multi-tenant use.';
comment on policy shared_v1_anon_insert_stock_document_lines on public.stock_document_lines is
  'WARNING: shared anonymous v1 access; replace with authenticated tenant policies before sensitive or multi-tenant use.';

grant usage on schema public to anon;
grant select, insert, update on public.shoe_models, public.colors to anon;
grant select, update on public.product_variants to anon;
grant select, insert, update on public.inventory_balances to anon;
grant select, insert on public.stock_documents, public.stock_document_lines to anon;
grant usage, select on sequence public.inventory_document_number_seq to anon;
revoke all on function public.post_stock_document(jsonb) from public;
grant execute on function public.post_stock_document(jsonb) to anon;
revoke all on function public.set_inventory_updated_at() from public, anon;
revoke all on function public.validate_stock_document_line() from public, anon;

insert into public.shoe_models (name)
values ('Paris'), ('Castor'), ('Weave')
on conflict do nothing;

insert into public.colors (name)
values ('Black'), ('Navy'), ('Olive'), ('Brown'), ('Sand')
on conflict do nothing;

with catalog_pairs (model_name, color_name) as (
  values
    ('Paris', 'Black'), ('Paris', 'Navy'), ('Paris', 'Olive'),
    ('Castor', 'Black'), ('Castor', 'Brown'), ('Castor', 'Olive'),
    ('Weave', 'Black'), ('Weave', 'Brown'), ('Weave', 'Sand')
), sizes (size) as (
  values
    (38.0::numeric(4,1)), (38.5::numeric(4,1)), (39.0::numeric(4,1)),
    (40.0::numeric(4,1)), (41.0::numeric(4,1)), (42.0::numeric(4,1)),
    (43.5::numeric(4,1))
)
insert into public.product_variants (model_id, color_id, size)
select model.id, color.id, sizes.size
from catalog_pairs pair
join public.shoe_models model on lower(model.name) = lower(pair.model_name)
join public.colors color on lower(color.name) = lower(pair.color_name)
cross join sizes
on conflict (model_id, color_id, size) do nothing;

insert into public.inventory_balances (variant_id, quantity)
select id, 0 from public.product_variants
on conflict (variant_id) do nothing;
