-- Production orders are plans, not inventory movements. Direct table writes stay
-- private; the anonymous shared client uses the narrow SECURITY DEFINER RPCs.

create sequence public.production_order_number_sequence;

create table public.production_orders (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  client_request_id uuid not null unique,
  order_number text not null unique,
  order_date date not null,
  expected_date date not null,
  note text not null default '',
  status text not null default 'OPEN' check (status in ('OPEN', 'RECEIVED', 'CANCELLED')),
  received_document_id uuid unique references public.stock_documents(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  received_at timestamptz,
  cancelled_at timestamptz,
  check (expected_date >= order_date),
  check ((status = 'RECEIVED') = (received_document_id is not null)),
  check ((status = 'RECEIVED') = (received_at is not null)),
  check ((status = 'CANCELLED') = (cancelled_at is not null))
);

create index production_orders_status_date_idx
  on public.production_orders (status, order_date desc, created_at desc);

create table public.production_order_lines (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  order_id uuid not null references public.production_orders(id) on delete cascade,
  line_number integer not null check (line_number > 0),
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  model_name text not null check (btrim(model_name) <> ''),
  color_name text not null check (btrim(color_name) <> ''),
  size numeric(5,1) not null check (size > 0),
  quantity integer not null check (quantity > 0),
  unique (order_id, line_number),
  unique (order_id, variant_id)
);

create index production_order_lines_variant_idx
  on public.production_order_lines (variant_id, order_id);

create or replace function public.production_order_json(target_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select pg_catalog.jsonb_build_object(
    'id', production_order.id,
    'number', production_order.order_number,
    'orderDate', production_order.order_date,
    'expectedDate', production_order.expected_date,
    'note', production_order.note,
    'status', production_order.status,
    'receivedDocumentId', production_order.received_document_id,
    'createdAt', production_order.created_at,
    'updatedAt', production_order.updated_at,
    'receivedAt', production_order.received_at,
    'cancelledAt', production_order.cancelled_at,
    'lines', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', line.id,
          'variantId', line.variant_id,
          'lineNumber', line.line_number,
          'modelName', line.model_name,
          'colorName', line.color_name,
          'size', line.size,
          'quantity', line.quantity
        ) order by line.line_number
      )
      from public.production_order_lines line
      where line.order_id = production_order.id
    ), '[]'::jsonb)
  )
  from public.production_orders production_order
  where production_order.id = target_order_id;
$$;

create or replace function public.get_production_orders()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
    pg_catalog.jsonb_agg(
      public.production_order_json(production_order.id)
      order by production_order.created_at desc, production_order.id
    ),
    '[]'::jsonb
  )
  from public.production_orders production_order;
$$;

create or replace function public.save_production_order(command jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  creating boolean;
  request_id uuid;
  target_order_id uuid;
  order_date_value date;
  expected_date_value date;
  note_value text;
  next_order_sequence bigint;
  locked_order public.production_orders%rowtype;
  line jsonb;
  line_number_value integer := 0;
  line_variant_text text;
  line_variant_id uuid;
  line_quantity_numeric numeric;
  variant_record record;
  seen_variants uuid[] := array[]::uuid[];
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object' then
    raise exception using errcode = 'P0001', message = 'INVALID_PRODUCTION_ORDER';
  end if;

  creating := not (command ? 'orderId');
  if creating then
    if pg_catalog.jsonb_typeof(command -> 'requestId') is distinct from 'string'
      or command ->> 'requestId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using errcode = 'P0001', message = 'INVALID_PRODUCTION_ORDER';
    end if;
    request_id := (command ->> 'requestId')::uuid;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(request_id::text, 0)
    );
    select production_order.* into locked_order
    from public.production_orders production_order
    where production_order.client_request_id = request_id;
    if found then
      return public.production_order_json(locked_order.id);
    end if;
  else
    if pg_catalog.jsonb_typeof(command -> 'orderId') is distinct from 'string'
      or command ->> 'orderId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using errcode = 'P0001', message = 'INVALID_PRODUCTION_ORDER';
    end if;
    target_order_id := (command ->> 'orderId')::uuid;
    select production_order.* into locked_order
    from public.production_orders production_order
    where production_order.id = target_order_id
    for update of production_order;
    if not found then
      raise exception using errcode = 'P0001', message = 'PRODUCTION_ORDER_NOT_FOUND';
    end if;
    if locked_order.status <> 'OPEN' then
      raise exception using errcode = 'P0001', message = 'PRODUCTION_ORDER_NOT_OPEN';
    end if;
  end if;

  if pg_catalog.jsonb_typeof(command -> 'orderDate') is distinct from 'string'
    or command ->> 'orderDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or pg_catalog.jsonb_typeof(command -> 'expectedDate') is distinct from 'string'
    or command ->> 'expectedDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or (command ? 'note' and pg_catalog.jsonb_typeof(command -> 'note') not in ('string', 'null'))
    or pg_catalog.jsonb_typeof(command -> 'lines') is distinct from 'array'
    or pg_catalog.jsonb_array_length(command -> 'lines') = 0 then
    raise exception using errcode = 'P0001', message = 'INVALID_PRODUCTION_ORDER';
  end if;

  begin
    order_date_value := (command ->> 'orderDate')::date;
    expected_date_value := (command ->> 'expectedDate')::date;
  exception when others then
    raise exception using errcode = 'P0001', message = 'INVALID_PRODUCTION_ORDER';
  end;
  if pg_catalog.to_char(order_date_value, 'YYYY-MM-DD') <> command ->> 'orderDate'
    or pg_catalog.to_char(expected_date_value, 'YYYY-MM-DD') <> command ->> 'expectedDate'
    or expected_date_value < order_date_value then
    raise exception using errcode = 'P0001', message = 'INVALID_PRODUCTION_ORDER';
  end if;
  note_value := pg_catalog.btrim(coalesce(command ->> 'note', ''));

  if creating then
    next_order_sequence := pg_catalog.nextval('public.production_order_number_sequence'::regclass);
    insert into public.production_orders (
      client_request_id,
      order_number,
      order_date,
      expected_date,
      note
    ) values (
      request_id,
      'PO-' || pg_catalog.to_char(order_date_value, 'YYYYMMDD') || '-'
        || pg_catalog.lpad(next_order_sequence::text, 6, '0'),
      order_date_value,
      expected_date_value,
      note_value
    ) returning id into target_order_id;
  else
    update public.production_orders
    set order_date = order_date_value,
        expected_date = expected_date_value,
        note = note_value,
        updated_at = statement_timestamp()
    where id = target_order_id;
    delete from public.production_order_lines line where line.order_id = target_order_id;
  end if;

  for line in select value from pg_catalog.jsonb_array_elements(command -> 'lines')
  loop
    if pg_catalog.jsonb_typeof(line) is distinct from 'object'
      or pg_catalog.jsonb_typeof(line -> 'variantId') is distinct from 'string'
      or line ->> 'variantId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or pg_catalog.jsonb_typeof(line -> 'quantity') is distinct from 'number' then
      raise exception using errcode = 'P0001', message = 'INVALID_PRODUCTION_ORDER';
    end if;
    line_variant_text := line ->> 'variantId';
    line_variant_id := line_variant_text::uuid;
    begin
      line_quantity_numeric := (line ->> 'quantity')::numeric;
    exception when others then
      raise exception using errcode = 'P0001', message = 'INVALID_PRODUCTION_ORDER';
    end;
    if line_quantity_numeric < 1
      or line_quantity_numeric <> pg_catalog.trunc(line_quantity_numeric)
      or line_quantity_numeric > 2147483647 then
      raise exception using errcode = 'P0001', message = 'INVALID_PRODUCTION_ORDER';
    end if;
    if line_variant_id = any(seen_variants) then
      raise exception using errcode = 'P0001', message = 'DUPLICATE_PRODUCTION_VARIANT';
    end if;
    seen_variants := pg_catalog.array_append(seen_variants, line_variant_id);

    select
      variant.id,
      variant.size,
      model.name as model_name,
      color.name as color_name
    into variant_record
    from public.product_variants variant
    join public.shoe_models model on model.id = variant.model_id
    join public.colors color on color.id = variant.color_id
    where variant.id = line_variant_id
      and variant.active
      and model.active
      and color.active;
    if not found then
      raise exception using errcode = 'P0001', message = 'PRODUCTION_VARIANT_NOT_FOUND';
    end if;

    line_number_value := line_number_value + 1;
    insert into public.production_order_lines (
      order_id,
      line_number,
      variant_id,
      model_name,
      color_name,
      size,
      quantity
    ) values (
      target_order_id,
      line_number_value,
      line_variant_id,
      variant_record.model_name,
      variant_record.color_name,
      variant_record.size,
      line_quantity_numeric::integer
    );
  end loop;

  return public.production_order_json(target_order_id);
end;
$$;

create or replace function public.cancel_production_order(command jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_order_id uuid;
  locked_order public.production_orders%rowtype;
begin
  if command is null
    or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or pg_catalog.jsonb_typeof(command -> 'orderId') is distinct from 'string'
    or command ->> 'orderId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_PRODUCTION_ORDER';
  end if;
  target_order_id := (command ->> 'orderId')::uuid;

  select production_order.* into locked_order
  from public.production_orders production_order
  where production_order.id = target_order_id
  for update of production_order;
  if not found then
    raise exception using errcode = 'P0001', message = 'PRODUCTION_ORDER_NOT_FOUND';
  end if;
  if locked_order.status = 'RECEIVED' then
    raise exception using errcode = 'P0001', message = 'PRODUCTION_ORDER_RECEIVED';
  end if;
  if locked_order.status = 'CANCELLED' then
    return public.production_order_json(target_order_id);
  end if;

  update public.production_orders
  set status = 'CANCELLED',
      cancelled_at = statement_timestamp(),
      updated_at = statement_timestamp()
  where id = target_order_id;
  return public.production_order_json(target_order_id);
end;
$$;

create or replace function public.receive_production_order(command jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  request_id uuid;
  target_order_id uuid;
  effective_on date;
  locked_order public.production_orders%rowtype;
  receipt_request_id uuid;
  receipt_lines jsonb;
  receipt_command jsonb;
  posted_document jsonb;
begin
  if command is null
    or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or pg_catalog.jsonb_typeof(command -> 'requestId') is distinct from 'string'
    or command ->> 'requestId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or pg_catalog.jsonb_typeof(command -> 'orderId') is distinct from 'string'
    or command ->> 'orderId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or pg_catalog.jsonb_typeof(command -> 'effectiveDate') is distinct from 'string'
    or command ->> 'effectiveDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_PRODUCTION_ORDER_RECEIPT';
  end if;

  request_id := (command ->> 'requestId')::uuid;
  target_order_id := (command ->> 'orderId')::uuid;
  begin
    effective_on := (command ->> 'effectiveDate')::date;
  exception when others then
    raise exception using errcode = 'P0001', message = 'INVALID_PRODUCTION_ORDER_RECEIPT';
  end;
  if pg_catalog.to_char(effective_on, 'YYYY-MM-DD') <> command ->> 'effectiveDate' then
    raise exception using errcode = 'P0001', message = 'INVALID_PRODUCTION_ORDER_RECEIPT';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(request_id::text, 0)
  );

  select production_order.* into locked_order
  from public.production_orders production_order
  where production_order.id = target_order_id
  for update of production_order;
  if not found then
    raise exception using errcode = 'P0001', message = 'PRODUCTION_ORDER_NOT_FOUND';
  end if;

  if locked_order.status = 'RECEIVED' then
    select document.client_request_id into receipt_request_id
    from public.stock_documents document
    where document.id = locked_order.received_document_id;
    if receipt_request_id is null then
      raise exception using errcode = 'P0001', message = 'PRODUCTION_ORDER_RECEIPT_NOT_FOUND';
    end if;
    posted_document := public.post_stock_document(
      pg_catalog.jsonb_build_object('requestId', receipt_request_id)
    );
    return pg_catalog.jsonb_build_object(
      'order', public.production_order_json(locked_order.id),
      'document', posted_document
    );
  end if;

  if locked_order.status = 'CANCELLED' then
    raise exception using errcode = 'P0001', message = 'PRODUCTION_ORDER_CANCELLED';
  end if;

  if exists (
    select 1 from public.stock_documents document
    where document.client_request_id = request_id
  ) then
    raise exception using errcode = 'P0001', message = 'INVALID_PRODUCTION_ORDER_RECEIPT';
  end if;

  select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'variantId', line.variant_id,
      'size', line.size,
      'quantity', line.quantity
    ) order by line.line_number
  ) into receipt_lines
  from public.production_order_lines line
  where line.order_id = target_order_id;
  if receipt_lines is null or pg_catalog.jsonb_array_length(receipt_lines) = 0 then
    raise exception using errcode = 'P0001', message = 'INVALID_PRODUCTION_ORDER_RECEIPT';
  end if;

  receipt_command := pg_catalog.jsonb_build_object(
    'requestId', request_id,
    'type', 'RECEIPT',
    'effectiveDate', effective_on::text,
    'reference', locked_order.order_number,
    'note', 'รับเข้าจากใบผลิต ' || locked_order.order_number,
    'lines', receipt_lines
  );
  posted_document := public.post_stock_document(receipt_command);

  update public.production_orders
  set received_document_id = (posted_document ->> 'id')::uuid,
      status = 'RECEIVED',
      received_at = statement_timestamp(),
      updated_at = statement_timestamp()
  where id = target_order_id;

  return pg_catalog.jsonb_build_object(
    'order', public.production_order_json(target_order_id),
    'document', posted_document
  );
end;
$$;

alter table public.production_orders enable row level security;
alter table public.production_order_lines enable row level security;

revoke all on public.production_orders, public.production_order_lines
  from public, anon, authenticated;
revoke all on sequence public.production_order_number_sequence
  from public, anon, authenticated;

alter function public.production_order_json(uuid) owner to postgres;
alter function public.get_production_orders() owner to postgres;
alter function public.save_production_order(jsonb) owner to postgres;
alter function public.cancel_production_order(jsonb) owner to postgres;
alter function public.receive_production_order(jsonb) owner to postgres;

revoke all on function public.production_order_json(uuid) from public, anon, authenticated;
revoke all on function public.get_production_orders() from public, anon, authenticated;
revoke all on function public.save_production_order(jsonb) from public, anon, authenticated;
revoke all on function public.cancel_production_order(jsonb) from public, anon, authenticated;
revoke all on function public.receive_production_order(jsonb) from public, anon, authenticated;

grant execute on function public.get_production_orders() to anon, authenticated;
grant execute on function public.save_production_order(jsonb) to anon, authenticated;
grant execute on function public.cancel_production_order(jsonb) to anon, authenticated;
grant execute on function public.receive_production_order(jsonb) to anon, authenticated;
