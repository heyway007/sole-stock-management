begin;

alter table public.production_order_lines
  add column received_quantity integer not null default 0;

-- Backfill legacy completed orders before enforcing the progress bounds.
update public.production_order_lines line
set received_quantity = line.quantity
from public.production_orders production_order
where production_order.id = line.order_id
  and production_order.status = 'RECEIVED';

alter table public.production_order_lines
  add constraint production_order_lines_received_quantity_bounds
  check (received_quantity >= 0 and received_quantity <= quantity);

create table public.production_order_receipts (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  order_id uuid not null references public.production_orders(id) on delete cascade,
  document_id uuid not null unique references public.stock_documents(id) on delete restrict,
  client_request_id uuid not null unique,
  created_at timestamptz not null default statement_timestamp()
);

create index production_order_receipts_order_idx
  on public.production_order_receipts (order_id, created_at, id);

insert into public.production_order_receipts (order_id, document_id, client_request_id)
select production_order.id, production_order.received_document_id, document.client_request_id
from public.production_orders production_order
join public.stock_documents document on document.id = production_order.received_document_id
where production_order.received_document_id is not null
on conflict (document_id) do nothing;

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
    'receiptDocumentIds', coalesce((
      select pg_catalog.jsonb_agg(receipt.document_id order by receipt.created_at, receipt.id)
      from public.production_order_receipts receipt
      where receipt.order_id = production_order.id
    ), '[]'::jsonb),
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
          'quantity', line.quantity,
          'receivedQuantity', line.received_quantity,
          'unitPrice', line.unit_price
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
  line_unit_price_numeric numeric;
  retained_received_quantity integer;
  retained_received_by_variant jsonb := '{}'::jsonb;
  variant_record record;
  seen_variants uuid[] := array[]::uuid[];
begin
  if command is null
    or pg_catalog.jsonb_typeof(command) is distinct from 'object' then
    raise exception using errcode = 'P0001', message = 'INVALID_PRODUCTION_ORDER';
  end if;

  creating := not (command ? 'orderId');
  if creating then
    if pg_catalog.jsonb_typeof(command -> 'requestId') is distinct from 'string'
      or command ->> 'requestId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using errcode = 'P0001', message = 'INVALID_PRODUCTION_ORDER';
    end if;
    request_id := (command ->> 'requestId')::uuid;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(request_id::text, 0));
    select production_order.* into locked_order
    from public.production_orders production_order
    where production_order.client_request_id = request_id;
    if found then return public.production_order_json(locked_order.id); end if;
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
    if not found then raise exception using errcode = 'P0001', message = 'PRODUCTION_ORDER_NOT_FOUND'; end if;
    if locked_order.status <> 'OPEN' then raise exception using errcode = 'P0001', message = 'PRODUCTION_ORDER_NOT_OPEN'; end if;
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
      client_request_id, order_number, order_date, expected_date, note
    ) values (
      request_id,
      'PO-' || pg_catalog.to_char(order_date_value, 'YYYYMMDD') || '-' || pg_catalog.lpad(next_order_sequence::text, 6, '0'),
      order_date_value, expected_date_value, note_value
    ) returning id into target_order_id;
  else
    update public.production_orders
    set order_date = order_date_value,
        expected_date = expected_date_value,
        note = note_value,
        updated_at = statement_timestamp()
    where id = target_order_id;
  end if;

  if not creating then
    select coalesce(
      pg_catalog.jsonb_object_agg(production_line.variant_id::text, production_line.received_quantity),
      '{}'::jsonb
    ) into retained_received_by_variant
    from public.production_order_lines production_line
    where production_line.order_id = target_order_id;
    delete from public.production_order_lines line where line.order_id = target_order_id;
  end if;

  for line in select value from pg_catalog.jsonb_array_elements(command -> 'lines') loop
    if pg_catalog.jsonb_typeof(line) is distinct from 'object'
      or pg_catalog.jsonb_typeof(line -> 'variantId') is distinct from 'string'
      or line ->> 'variantId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or pg_catalog.jsonb_typeof(line -> 'quantity') is distinct from 'number'
      or pg_catalog.jsonb_typeof(line -> 'unitPrice') is distinct from 'number' then
      raise exception using errcode = 'P0001', message = 'INVALID_PRODUCTION_ORDER';
    end if;
    line_variant_id := (line ->> 'variantId')::uuid;
    begin
      line_quantity_numeric := (line ->> 'quantity')::numeric;
      line_unit_price_numeric := (line ->> 'unitPrice')::numeric;
    exception when others then
      raise exception using errcode = 'P0001', message = 'INVALID_PRODUCTION_ORDER';
    end;
    if line_quantity_numeric < 1
      or line_quantity_numeric <> pg_catalog.trunc(line_quantity_numeric)
      or line_quantity_numeric > 2147483647
      or line_unit_price_numeric <= 0
      or line_unit_price_numeric > 9999999999.99
      or line_unit_price_numeric <> pg_catalog.round(line_unit_price_numeric, 2) then
      raise exception using errcode = 'P0001', message = 'INVALID_PRODUCTION_ORDER';
    end if;
    if line_variant_id = any(seen_variants) then
      raise exception using errcode = 'P0001', message = 'DUPLICATE_PRODUCTION_VARIANT';
    end if;
    seen_variants := pg_catalog.array_append(seen_variants, line_variant_id);
    select variant.id, variant.size, model.name as model_name, color.name as color_name
    into variant_record
    from public.product_variants variant
    join public.shoe_models model on model.id = variant.model_id
    join public.colors color on color.id = variant.color_id
    where variant.id = line_variant_id and variant.active and model.active and color.active;
    if not found then raise exception using errcode = 'P0001', message = 'PRODUCTION_VARIANT_NOT_FOUND'; end if;

    retained_received_quantity := 0;
    if not creating then
      retained_received_quantity := coalesce(
        (retained_received_by_variant ->> line_variant_id::text)::integer,
        0
      );
      if line_quantity_numeric < retained_received_quantity then
        raise exception using errcode = 'P0001', message = 'PRODUCTION_ORDER_RECEIVED_QUANTITY_EXCEEDS_NEW_QUANTITY';
      end if;
    end if;
    line_number_value := line_number_value + 1;
    insert into public.production_order_lines (
      order_id, line_number, variant_id, model_name, color_name, size, quantity, received_quantity, unit_price
    ) values (
      target_order_id, line_number_value, line_variant_id, variant_record.model_name, variant_record.color_name,
      variant_record.size, line_quantity_numeric::integer, retained_received_quantity, line_unit_price_numeric::numeric(12,2)
    );
  end loop;

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
  existing_document_id uuid;
  receipt_lines jsonb := '[]'::jsonb;
  receipt_command jsonb;
  posted_document jsonb;
  command_line jsonb;
  line public.production_order_lines%rowtype;
  line_id uuid;
  selected_quantity integer;
  seen_line_ids uuid[] := array[]::uuid[];
  all_received boolean;
begin
  if command is null
    or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or pg_catalog.jsonb_typeof(command -> 'requestId') is distinct from 'string'
    or command ->> 'requestId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or pg_catalog.jsonb_typeof(command -> 'orderId') is distinct from 'string'
    or command ->> 'orderId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or pg_catalog.jsonb_typeof(command -> 'effectiveDate') is distinct from 'string'
    or command ->> 'effectiveDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or (command ? 'lines' and pg_catalog.jsonb_typeof(command -> 'lines') is distinct from 'array') then
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

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(request_id::text, 0));
  select receipt.document_id into existing_document_id
  from public.production_order_receipts receipt
  where receipt.client_request_id = request_id;
  if existing_document_id is not null then
    posted_document := public.post_stock_document(pg_catalog.jsonb_build_object('requestId', request_id));
    return pg_catalog.jsonb_build_object(
      'order', public.production_order_json(target_order_id),
      'document', posted_document
    );
  end if;

  select production_order.* into locked_order
  from public.production_orders production_order
  where production_order.id = target_order_id
  for update of production_order;
  if not found then raise exception using errcode = 'P0001', message = 'PRODUCTION_ORDER_NOT_FOUND'; end if;
  if locked_order.status = 'RECEIVED' then raise exception using errcode = 'P0001', message = 'PRODUCTION_ORDER_RECEIVED'; end if;
  if locked_order.status = 'CANCELLED' then raise exception using errcode = 'P0001', message = 'PRODUCTION_ORDER_CANCELLED'; end if;

  if command ? 'lines' then
    if pg_catalog.jsonb_array_length(command -> 'lines') = 0 then
      raise exception using errcode = 'P0001', message = 'INVALID_PRODUCTION_ORDER_RECEIPT';
    end if;
    for command_line in select value from pg_catalog.jsonb_array_elements(command -> 'lines') loop
      if pg_catalog.jsonb_typeof(command_line) is distinct from 'object'
        or pg_catalog.jsonb_typeof(command_line -> 'lineId') is distinct from 'string'
        or command_line ->> 'lineId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or pg_catalog.jsonb_typeof(command_line -> 'quantity') is distinct from 'number' then
        raise exception using errcode = 'P0001', message = 'INVALID_PRODUCTION_ORDER_RECEIPT';
      end if;
      line_id := (command_line ->> 'lineId')::uuid;
      selected_quantity := (command_line ->> 'quantity')::integer;
      if line_id = any(seen_line_ids)
        or selected_quantity < 1
        or (command_line ->> 'quantity')::numeric <> selected_quantity then
        raise exception using errcode = 'P0001', message = 'INVALID_PRODUCTION_ORDER_RECEIPT';
      end if;
      select production_line.* into line
      from public.production_order_lines production_line
      where production_line.id = line_id and production_line.order_id = target_order_id
      for update;
      if not found or selected_quantity > line.quantity - line.received_quantity then
        raise exception using errcode = 'P0001', message = 'INVALID_PRODUCTION_ORDER_RECEIPT';
      end if;
      seen_line_ids := pg_catalog.array_append(seen_line_ids, line_id);
      receipt_lines := receipt_lines || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('variantId', line.variant_id, 'size', line.size, 'quantity', selected_quantity)
      );
    end loop;
  else
    for line in
      select production_line.*
      from public.production_order_lines production_line
      where production_line.order_id = target_order_id
        and production_line.received_quantity < production_line.quantity
      order by production_line.line_number
      for update
    loop
      selected_quantity := line.quantity - line.received_quantity;
      receipt_lines := receipt_lines || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('variantId', line.variant_id, 'size', line.size, 'quantity', selected_quantity)
      );
      seen_line_ids := pg_catalog.array_append(seen_line_ids, line.id);
    end loop;
  end if;

  if pg_catalog.jsonb_array_length(receipt_lines) = 0 then
    raise exception using errcode = 'P0001', message = 'INVALID_PRODUCTION_ORDER_RECEIPT';
  end if;
  receipt_command := pg_catalog.jsonb_build_object(
    'requestId', request_id,
    'type', 'RECEIPT',
    'effectiveDate', effective_on::text,
    'reference', locked_order.order_number,
    'note', 'à¸£à¸±à¸šà¹€à¸‚à¹‰à¸²à¸ˆà¸²à¸à¹ƒà¸šà¸œà¸¥à¸´à¸• ' || locked_order.order_number,
    'lines', receipt_lines
  );
  posted_document := public.post_stock_document(receipt_command);

  for command_line in select value from pg_catalog.jsonb_array_elements(receipt_lines) loop
    selected_quantity := (command_line ->> 'quantity')::integer;
    select production_line.* into line
    from public.production_order_lines production_line
    where production_line.order_id = target_order_id
      and production_line.variant_id = (command_line ->> 'variantId')::uuid
    for update;
    update public.production_order_lines
    set received_quantity = line.received_quantity + selected_quantity
    where public.production_order_lines.id = line.id;
  end loop;

  insert into public.production_order_receipts (order_id, document_id, client_request_id)
  values (target_order_id, (posted_document ->> 'id')::uuid, request_id);

  select not exists (
    select 1 from public.production_order_lines production_line
    where production_line.order_id = target_order_id
      and production_line.received_quantity < production_line.quantity
  ) into all_received;
  update public.production_orders
  set received_document_id = (posted_document ->> 'id')::uuid,
      status = case when all_received then 'RECEIVED' else 'OPEN' end,
      received_at = case when all_received then statement_timestamp() else null end,
      updated_at = statement_timestamp()
  where id = target_order_id;

  return pg_catalog.jsonb_build_object(
    'order', public.production_order_json(target_order_id),
    'document', posted_document
  );
end;
$$;

alter function public.production_order_json(uuid) owner to postgres;
alter function public.get_production_orders() owner to postgres;
alter function public.save_production_order(jsonb) owner to postgres;
alter function public.receive_production_order(jsonb) owner to postgres;

revoke all on public.production_order_receipts from public, anon, authenticated;
revoke all on function public.production_order_json(uuid) from public, anon, authenticated;
revoke all on function public.get_production_orders() from public, anon, authenticated;
revoke all on function public.save_production_order(jsonb) from public, anon, authenticated;
revoke all on function public.receive_production_order(jsonb) from public, anon, authenticated;

grant execute on function public.production_order_json(uuid) to anon, authenticated;
grant execute on function public.get_production_orders() to anon, authenticated;
grant execute on function public.save_production_order(jsonb) to anon, authenticated;
grant execute on function public.receive_production_order(jsonb) to anon, authenticated;

commit;
