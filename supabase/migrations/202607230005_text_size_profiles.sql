-- Forward-only upgrade from numeric shoe sizes to canonical text labels.
-- Existing variant identities, balances, stock history, and production orders
-- remain in place; only the two size column types and affected RPCs change.

create or replace function public.normalize_size_label(raw_label text)
returns text
language sql
immutable
strict
security invoker
set search_path = pg_catalog, public
as $$
  select pg_catalog.upper(
    pg_catalog.regexp_replace(
      pg_catalog.btrim(raw_label),
      '[[:space:]]+',
      ' ',
      'g'
    )
  );
$$;

alter table public.product_variants
  drop constraint product_variants_model_color_size_key,
  drop constraint product_variants_size_positive;

alter table public.product_variants alter column size type text
  using public.normalize_size_label(
    pg_catalog.rtrim(pg_catalog.rtrim(size::text, '0'), '.')
  );

alter table public.product_variants
  add constraint product_variants_size_label_valid check (
    size = public.normalize_size_label(size)
    and pg_catalog.char_length(size) between 1 and 24
    and size !~ '[[:cntrl:]]'
  );

create unique index product_variants_model_color_size_label_key
  on public.product_variants (model_id, color_id, pg_catalog.lower(size));

alter table public.production_order_lines
  drop constraint production_order_lines_size_check;

alter table public.production_order_lines alter column size type text
  using public.normalize_size_label(
    pg_catalog.rtrim(pg_catalog.rtrim(size::text, '0'), '.')
  );

alter table public.production_order_lines
  add constraint production_order_lines_size_label_valid check (
    size = public.normalize_size_label(size)
    and pg_catalog.char_length(size) between 1 and 24
    and size !~ '[[:cntrl:]]'
  );

with profiles (model_name, size_label) as (
  values
    ('Paris', 'XS'),
    ('Paris', 'S'),
    ('Paris', 'M'),
    ('Paris', 'L'),
    ('Paris', 'XL'),
    ('Paris', '2XL'),
    ('Paris', '3XL'),
    ('Castor', 'XS'),
    ('Castor', 'S'),
    ('Castor', 'M'),
    ('Castor', 'L'),
    ('Castor', 'XL'),
    ('Castor', '2XL'),
    ('Castor', '3XL'),
    ('Weave', '39'),
    ('Weave', '40'),
    ('Weave', '41'),
    ('Weave', '42'),
    ('Weave', '43'),
    ('Weave', '44'),
    ('Weave', '45')
), configured_pairs as (
  select distinct
    variant.model_id,
    variant.color_id,
    pg_catalog.lower(model.name) as model_name
  from public.product_variants variant
  join public.shoe_models model on model.id = variant.model_id
)
insert into public.product_variants (model_id, color_id, size)
select pair.model_id, pair.color_id, profile.size_label
from configured_pairs pair
join profiles profile
  on pg_catalog.lower(profile.model_name) = pair.model_name
on conflict do nothing;

insert into public.inventory_balances (variant_id, quantity)
select variant.id, 0
from public.product_variants variant
on conflict (variant_id) do nothing;

create or replace function public.get_inventory_snapshot()
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select pg_catalog.jsonb_build_object(
    'models', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', model.id,
          'name', model.name,
          'active', model.active
        ) order by pg_catalog.lower(model.name), model.id
      )
      from public.shoe_models model
    ), '[]'::jsonb),
    'colors', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', color.id,
          'name', color.name,
          'active', color.active
        ) order by pg_catalog.lower(color.name), color.id
      )
      from public.colors color
    ), '[]'::jsonb),
    'variants', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', variant.id,
          'model_id', variant.model_id,
          'color_id', variant.color_id,
          'size', variant.size,
          'low_stock_threshold', variant.low_stock_threshold,
          'active', variant.active
        ) order by
          variant.model_id,
          variant.color_id,
          variant.size,
          variant.id
      )
      from public.product_variants variant
    ), '[]'::jsonb),
    'balances', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'variant_id', balance.variant_id,
          'quantity', balance.quantity
        ) order by balance.variant_id
      )
      from public.inventory_balances balance
    ), '[]'::jsonb),
    'documents', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', document.id,
          'client_request_id', document.client_request_id,
          'document_number', document.document_number,
          'movement_type', document.movement_type,
          'effective_date', document.effective_date,
          'reference', document.reference,
          'note', document.note,
          'created_at', document.created_at
        ) order by
          document.created_at,
          document.document_number,
          document.id
      )
      from public.stock_documents document
    ), '[]'::jsonb),
    'lines', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', line.id,
          'document_id', line.document_id,
          'variant_id', line.variant_id,
          'delta', line.delta,
          'exchange_section', line.exchange_section,
          'note', line.note
        ) order by line.document_id, line.line_number, line.id
      )
      from public.stock_document_lines line
    ), '[]'::jsonb)
  );
$$;

drop function if exists public.ensure_product_variant(uuid, uuid, numeric);

create or replace function public.ensure_product_variant(
  p_model_id uuid,
  p_color_id uuid,
  p_size text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_size text := public.normalize_size_label(p_size);
  ensured_variant public.product_variants%rowtype;
begin
  if p_model_id is null
    or p_color_id is null
    or normalized_size is null
    or pg_catalog.char_length(normalized_size) not between 1 and 24
    or normalized_size ~ '[[:cntrl:]]' then
    raise exception using errcode = 'P0001', message = 'INVALID_SIZE_LABEL';
  end if;

  if not exists (
    select 1
    from public.shoe_models model
    where model.id = p_model_id and model.active
  ) or not exists (
    select 1
    from public.colors color
    where color.id = p_color_id and color.active
  ) then
    raise exception using errcode = 'P0001', message = 'INVALID_VARIANT';
  end if;

  insert into public.product_variants (model_id, color_id, size, active)
  values (p_model_id, p_color_id, normalized_size, true)
  on conflict (model_id, color_id, (pg_catalog.lower(size))) do update
    set active = true,
        updated_at = statement_timestamp()
  returning * into ensured_variant;

  insert into public.inventory_balances (variant_id, quantity)
  values (ensured_variant.id, 0)
  on conflict (variant_id) do nothing;

  return pg_catalog.jsonb_build_object(
    'id', ensured_variant.id,
    'modelId', ensured_variant.model_id,
    'colorId', ensured_variant.color_id,
    'size', ensured_variant.size,
    'lowStockThreshold', ensured_variant.low_stock_threshold,
    'active', ensured_variant.active
  );
end;
$$;

create or replace function public.post_stock_document(command jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  request_id uuid;
  movement text;
  effective_on date;
  new_document_id uuid;
  next_document_sequence bigint;
  new_document_number text;
  posted_document jsonb;
  line jsonb;
  line_variant_id uuid;
  line_variant_text text;
  line_quantity_numeric numeric;
  line_size_label text;
  has_returned boolean := false;
  has_replacement boolean := false;
begin
  if command is null
    or pg_catalog.jsonb_typeof(command) is distinct from 'object' then
    raise exception using errcode = 'P0001', message = 'INVALID_DOCUMENT';
  end if;

  if pg_catalog.jsonb_typeof(command -> 'requestId') is distinct from 'string'
    or command ->> 'requestId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_DOCUMENT';
  end if;
  request_id := (command ->> 'requestId')::uuid;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(request_id::text, 0)
  );

  select document.id
  into new_document_id
  from public.stock_documents document
  where document.client_request_id = request_id;

  if new_document_id is null then
    new_document_id := pg_catalog.gen_random_uuid();

    if pg_catalog.jsonb_typeof(command -> 'type') is distinct from 'string'
      or command ->> 'type' not in (
        'RECEIPT',
        'SALE',
        'DAMAGE',
        'ADJUSTMENT',
        'EXCHANGE'
      ) then
      raise exception using errcode = 'P0001', message = 'INVALID_DOCUMENT';
    end if;
    movement := command ->> 'type';

    if pg_catalog.jsonb_typeof(command -> 'effectiveDate') is distinct from 'string'
      or command ->> 'effectiveDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception using errcode = 'P0001', message = 'INVALID_DOCUMENT';
    end if;
    begin
      effective_on := (command ->> 'effectiveDate')::date;
    exception when others then
      raise exception using errcode = 'P0001', message = 'INVALID_DOCUMENT';
    end;
    if pg_catalog.to_char(effective_on, 'YYYY-MM-DD') <> command ->> 'effectiveDate' then
      raise exception using errcode = 'P0001', message = 'INVALID_DOCUMENT';
    end if;

    if (command ? 'reference'
        and pg_catalog.jsonb_typeof(command -> 'reference') not in ('string', 'null'))
      or (command ? 'note'
        and pg_catalog.jsonb_typeof(command -> 'note') not in ('string', 'null'))
      or pg_catalog.jsonb_typeof(command -> 'lines') is distinct from 'array'
      or pg_catalog.jsonb_array_length(command -> 'lines') = 0 then
      raise exception using errcode = 'P0001', message = 'INVALID_DOCUMENT';
    end if;

    for line in
      select value from pg_catalog.jsonb_array_elements(command -> 'lines')
    loop
      if pg_catalog.jsonb_typeof(line) is distinct from 'object'
        or pg_catalog.jsonb_typeof(line -> 'variantId') is distinct from 'string'
        or pg_catalog.jsonb_typeof(line -> 'size') not in ('number', 'string')
        or pg_catalog.jsonb_typeof(line -> 'quantity') is distinct from 'number'
        or (line ? 'note'
          and pg_catalog.jsonb_typeof(line -> 'note') not in ('string', 'null')) then
        raise exception using errcode = 'P0001', message = 'INVALID_DOCUMENT';
      end if;

      line_variant_text := line ->> 'variantId';
      if line_variant_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception using errcode = 'P0001', message = 'VARIANT_NOT_FOUND';
      end if;
      line_variant_id := line_variant_text::uuid;

      begin
        line_quantity_numeric := (line ->> 'quantity')::numeric;
      exception when others then
        raise exception using errcode = 'P0001', message = 'INVALID_DOCUMENT';
      end;
      line_size_label := public.normalize_size_label(line ->> 'size');
      if line_quantity_numeric < 1
        or line_quantity_numeric <> pg_catalog.trunc(line_quantity_numeric)
        or line_quantity_numeric > 2147483647
        or line_size_label is null
        or pg_catalog.char_length(line_size_label) not between 1 and 24
        or line_size_label ~ '[[:cntrl:]]' then
        raise exception using errcode = 'P0001', message = 'INVALID_DOCUMENT';
      end if;

      if not exists (
        select 1
        from public.product_variants variant
        where variant.id = line_variant_id
          and variant.size = line_size_label
      ) then
        raise exception using errcode = 'P0001', message = 'VARIANT_NOT_FOUND';
      end if;

      if movement = 'ADJUSTMENT' then
        if pg_catalog.jsonb_typeof(line -> 'direction') is distinct from 'string'
          or line ->> 'direction' not in ('IN', 'OUT')
          or line ? 'section' then
          raise exception using errcode = 'P0001', message = 'INVALID_DOCUMENT';
        end if;
      elsif movement = 'EXCHANGE' then
        if pg_catalog.jsonb_typeof(line -> 'section') is distinct from 'string'
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

    with parsed_lines as (
      select (item ->> 'variantId')::uuid as variant_id
      from pg_catalog.jsonb_array_elements(command -> 'lines') as source(item)
    )
    insert into public.inventory_balances (variant_id, quantity)
    select distinct variant_id, 0
    from parsed_lines
    order by variant_id
    on conflict (variant_id) do nothing;

    perform balance.variant_id
    from public.inventory_balances balance
    join (
      select distinct (item ->> 'variantId')::uuid as variant_id
      from pg_catalog.jsonb_array_elements(command -> 'lines') as source(item)
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
            when movement = 'ADJUSTMENT'
              and item ->> 'direction' = 'IN' then (item ->> 'quantity')::integer
            when movement = 'ADJUSTMENT' then -(item ->> 'quantity')::integer
            when item ->> 'section' = 'RETURNED' then (item ->> 'quantity')::integer
            else -(item ->> 'quantity')::integer
          end as delta
        from pg_catalog.jsonb_array_elements(command -> 'lines') as source(item)
      ), aggregated_deltas as (
        select variant_id, pg_catalog.sum(delta) as delta
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
            when movement = 'ADJUSTMENT'
              and item ->> 'direction' = 'IN' then (item ->> 'quantity')::integer
            when movement = 'ADJUSTMENT' then -(item ->> 'quantity')::integer
            when item ->> 'section' = 'RETURNED' then (item ->> 'quantity')::integer
            else -(item ->> 'quantity')::integer
          end as delta
        from pg_catalog.jsonb_array_elements(command -> 'lines') as source(item)
      ), aggregated_deltas as (
        select variant_id, pg_catalog.sum(delta) as delta
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

    next_document_sequence := pg_catalog.nextval(
      'public.inventory_document_number_seq'::regclass
    );
    new_document_number := pg_catalog.format(
      'STK-%s-%s',
      pg_catalog.to_char(effective_on, 'YYYYMMDD'),
      pg_catalog.lpad(
        next_document_sequence::text,
        greatest(6, pg_catalog.length(next_document_sequence::text)),
        '0'
      )
    );

    insert into public.stock_documents (
      id,
      client_request_id,
      document_number,
      movement_type,
      effective_date,
      reference,
      note
    ) values (
      new_document_id,
      request_id,
      new_document_number,
      movement,
      effective_on,
      coalesce(command ->> 'reference', ''),
      coalesce(command ->> 'note', '')
    );

    insert into public.stock_document_lines (
      document_id,
      variant_id,
      line_number,
      delta,
      exchange_section,
      note
    )
    select
      new_document_id,
      (item ->> 'variantId')::uuid,
      ordinality::integer,
      case
        when movement = 'RECEIPT' then (item ->> 'quantity')::integer
        when movement in ('SALE', 'DAMAGE') then -(item ->> 'quantity')::integer
        when movement = 'ADJUSTMENT'
          and item ->> 'direction' = 'IN' then (item ->> 'quantity')::integer
        when movement = 'ADJUSTMENT' then -(item ->> 'quantity')::integer
        when item ->> 'section' = 'RETURNED' then (item ->> 'quantity')::integer
        else -(item ->> 'quantity')::integer
      end,
      case when movement = 'EXCHANGE' then item ->> 'section' else null end,
      nullif(item ->> 'note', '')
    from pg_catalog.jsonb_array_elements(command -> 'lines')
      with ordinality as source(item, ordinality);

    with parsed_lines as (
      select
        (item ->> 'variantId')::uuid as variant_id,
        case
          when movement = 'RECEIPT' then (item ->> 'quantity')::integer
          when movement in ('SALE', 'DAMAGE') then -(item ->> 'quantity')::integer
          when movement = 'ADJUSTMENT'
            and item ->> 'direction' = 'IN' then (item ->> 'quantity')::integer
          when movement = 'ADJUSTMENT' then -(item ->> 'quantity')::integer
          when item ->> 'section' = 'RETURNED' then (item ->> 'quantity')::integer
          else -(item ->> 'quantity')::integer
        end as delta
      from pg_catalog.jsonb_array_elements(command -> 'lines') as source(item)
    ), aggregated_deltas as (
      select variant_id, pg_catalog.sum(delta) as delta
      from parsed_lines
      group by variant_id
    ), projected_balances as (
      select
        aggregate.variant_id,
        (balance.quantity::bigint + aggregate.delta)::integer as quantity
      from aggregated_deltas aggregate
      join public.inventory_balances balance using (variant_id)
    )
    insert into public.inventory_balances (variant_id, quantity)
    select variant_id, quantity
    from projected_balances
    order by variant_id
    on conflict (variant_id) do update
      set quantity = excluded.quantity,
          updated_at = pg_catalog.now();
  end if;

  select pg_catalog.jsonb_build_object(
    'id', document.id,
    'number', document.document_number,
    'type', document.movement_type,
    'effectiveDate', document.effective_date,
    'reference', document.reference,
    'note', document.note,
    'createdAt', document.created_at,
    'lines', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_strip_nulls(
          pg_catalog.jsonb_build_object(
            'id', line.id,
            'variantId', line.variant_id,
            'delta', line.delta,
            'section', line.exchange_section,
            'note', line.note
          )
        ) order by line.line_number, line.id
      )
      from public.stock_document_lines line
      where line.document_id = document.id
    ), '[]'::jsonb)
  )
  into posted_document
  from public.stock_documents document
  where document.id = new_document_id;

  if posted_document is null then
    raise exception using errcode = 'P0001', message = 'DOCUMENT_NOT_FOUND';
  end if;

  return posted_document;
end;
$$;

create or replace function public.clear_inventory_stock(command jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  request_id uuid;
  effective_on date;
  clear_lines jsonb;
  clear_command jsonb;
begin
  if command is null
    or pg_catalog.jsonb_typeof(command) is distinct from 'object' then
    raise exception using errcode = 'P0001', message = 'INVALID_DOCUMENT';
  end if;

  if pg_catalog.jsonb_typeof(command -> 'requestId') is distinct from 'string'
    or command ->> 'requestId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_DOCUMENT';
  end if;
  request_id := (command ->> 'requestId')::uuid;

  if pg_catalog.jsonb_typeof(command -> 'effectiveDate') is distinct from 'string'
    or command ->> 'effectiveDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_DOCUMENT';
  end if;
  begin
    effective_on := (command ->> 'effectiveDate')::date;
  exception when others then
    raise exception using errcode = 'P0001', message = 'INVALID_DOCUMENT';
  end;
  if pg_catalog.to_char(effective_on, 'YYYY-MM-DD') <> command ->> 'effectiveDate' then
    raise exception using errcode = 'P0001', message = 'INVALID_DOCUMENT';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(request_id::text, 0)
  );

  if exists (
    select 1
    from public.stock_documents document
    where document.client_request_id = request_id
  ) then
    return public.post_stock_document(
      pg_catalog.jsonb_build_object('requestId', request_id)
    );
  end if;

  perform balance.variant_id
  from public.inventory_balances balance
  order by balance.variant_id
  for update of balance;

  select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'variantId', balance.variant_id,
      'size', variant.size,
      'quantity', balance.quantity,
      'direction', 'OUT'
    ) order by balance.variant_id
  )
  into clear_lines
  from public.inventory_balances balance
  join public.product_variants variant on variant.id = balance.variant_id
  where balance.quantity > 0;

  if clear_lines is null then
    return null;
  end if;

  clear_command := pg_catalog.jsonb_build_object(
    'requestId', request_id,
    'type', 'ADJUSTMENT',
    'effectiveDate', pg_catalog.to_char(effective_on, 'YYYY-MM-DD'),
    'reference', 'CLEAR-STOCK',
    'note', 'ล้างสต๊อกทั้งคลัง',
    'lines', clear_lines
  );

  return public.post_stock_document(clear_command);
end;
$$;

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
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(request_id::text, 0)
    );
    select production_order.*
    into locked_order
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
    select production_order.*
    into locked_order
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
    or (command ? 'note'
      and pg_catalog.jsonb_typeof(command -> 'note') not in ('string', 'null'))
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
    next_order_sequence := pg_catalog.nextval(
      'public.production_order_number_sequence'::regclass
    );
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
    delete from public.production_order_lines line
    where line.order_id = target_order_id;
  end if;

  for line in
    select value from pg_catalog.jsonb_array_elements(command -> 'lines')
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

  select production_order.*
  into locked_order
  from public.production_orders production_order
  where production_order.id = target_order_id
  for update of production_order;
  if not found then
    raise exception using errcode = 'P0001', message = 'PRODUCTION_ORDER_NOT_FOUND';
  end if;

  if locked_order.status = 'RECEIVED' then
    select document.client_request_id
    into receipt_request_id
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
    select 1
    from public.stock_documents document
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
  )
  into receipt_lines
  from public.production_order_lines line
  where line.order_id = target_order_id;
  if receipt_lines is null
    or pg_catalog.jsonb_array_length(receipt_lines) = 0 then
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

alter function public.normalize_size_label(text) owner to postgres;
alter function public.get_inventory_snapshot() owner to postgres;
alter function public.ensure_product_variant(uuid, uuid, text) owner to postgres;
alter function public.post_stock_document(jsonb) owner to postgres;
alter function public.clear_inventory_stock(jsonb) owner to postgres;
alter function public.production_order_json(uuid) owner to postgres;
alter function public.get_production_orders() owner to postgres;
alter function public.save_production_order(jsonb) owner to postgres;
alter function public.receive_production_order(jsonb) owner to postgres;

revoke all on function public.normalize_size_label(text)
  from public, anon, authenticated;
revoke all on function public.get_inventory_snapshot()
  from public, anon, authenticated;
revoke all on function public.ensure_product_variant(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.post_stock_document(jsonb)
  from public, anon, authenticated;
revoke all on function public.clear_inventory_stock(jsonb)
  from public, anon, authenticated;
revoke all on function public.production_order_json(uuid)
  from public, anon, authenticated;
revoke all on function public.get_production_orders()
  from public, anon, authenticated;
revoke all on function public.save_production_order(jsonb)
  from public, anon, authenticated;
revoke all on function public.receive_production_order(jsonb)
  from public, anon, authenticated;

grant execute on function public.get_inventory_snapshot()
  to anon, authenticated;
grant execute on function public.ensure_product_variant(uuid, uuid, text)
  to anon, authenticated;
grant execute on function public.post_stock_document(jsonb)
  to anon, authenticated;
grant execute on function public.clear_inventory_stock(jsonb)
  to anon, authenticated;
grant execute on function public.get_production_orders()
  to anon, authenticated;
grant execute on function public.save_production_order(jsonb)
  to anon, authenticated;
grant execute on function public.receive_production_order(jsonb)
  to anon, authenticated;

comment on function public.normalize_size_label(text) is
  'Trusted canonical shoe-size normalization helper; direct public execution is revoked.';
comment on function public.ensure_product_variant(uuid, uuid, text) is
  'Fully open no-login v1 text-label variant creation RPC with case-insensitive uniqueness.';
