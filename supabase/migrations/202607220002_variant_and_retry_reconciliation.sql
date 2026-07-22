-- Forward-only upgrade for databases that already applied 202607220001.
-- Keep the original migration immutable so deployed migration history remains valid.

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
        ) order by variant.model_id, variant.color_id, variant.size, variant.id
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
        ) order by document.created_at, document.document_number, document.id
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

create or replace function public.ensure_product_variant(
  p_model_id uuid,
  p_color_id uuid,
  p_size numeric
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  ensured_variant public.product_variants%rowtype;
begin
  if p_model_id is null
    or p_color_id is null
    or p_size is null
    or p_size <= 0
    or p_size <> round(p_size, 1) then
    raise exception using errcode = 'P0001', message = 'INVALID_VARIANT';
  end if;

  if not exists (
    select 1 from public.shoe_models model
    where model.id = p_model_id and model.active
  ) or not exists (
    select 1 from public.colors color
    where color.id = p_color_id and color.active
  ) then
    raise exception using errcode = 'P0001', message = 'INVALID_VARIANT';
  end if;

  insert into public.product_variants (model_id, color_id, size, active)
  values (p_model_id, p_color_id, p_size, true)
  on conflict (model_id, color_id, size) do update
    set active = true,
        updated_at = now()
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

alter function public.get_inventory_snapshot() owner to postgres;
alter function public.ensure_product_variant(uuid, uuid, numeric) owner to postgres;

revoke all on function public.get_inventory_snapshot() from public, anon, authenticated;
revoke all on function public.ensure_product_variant(uuid, uuid, numeric) from public, anon, authenticated;
grant execute on function public.get_inventory_snapshot() to anon, authenticated;
grant execute on function public.ensure_product_variant(uuid, uuid, numeric) to anon, authenticated;

comment on function public.get_inventory_snapshot() is
  'Fully open no-login v1 read RPC returning one coherent, uncapped inventory snapshot, including retry reconciliation IDs.';
comment on function public.ensure_product_variant(uuid, uuid, numeric) is
  'Fully open no-login v1 variant creation RPC. The unique tuple and balance initialization are concurrency-safe; direct browser INSERT remains revoked.';
