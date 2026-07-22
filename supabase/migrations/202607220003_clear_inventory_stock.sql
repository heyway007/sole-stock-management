-- Atomically clear all positive inventory balances while preserving an audit document.

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
  if command is null or jsonb_typeof(command) is distinct from 'object' then
    raise exception using errcode = 'P0001', message = 'INVALID_DOCUMENT';
  end if;

  if jsonb_typeof(command -> 'requestId') is distinct from 'string'
    or command ->> 'requestId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_DOCUMENT';
  end if;
  request_id := (command ->> 'requestId')::uuid;

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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(request_id::text, 0)
  );

  if exists (
    select 1 from public.stock_documents document
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
    'effectiveDate', to_char(effective_on, 'YYYY-MM-DD'),
    'reference', 'CLEAR-STOCK',
    'note', 'ล้างสต๊อกทั้งคลัง',
    'lines', clear_lines
  );

  return public.post_stock_document(clear_command);
end;
$$;

alter function public.clear_inventory_stock(jsonb) owner to postgres;
revoke all on function public.clear_inventory_stock(jsonb) from public, anon, authenticated;
grant execute on function public.clear_inventory_stock(jsonb) to anon, authenticated;

comment on function public.clear_inventory_stock(jsonb) is
  'Fully open no-login v1 audited inventory clear. Locks every balance and delegates the atomic adjustment to post_stock_document.';
