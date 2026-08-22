begin;

-- The partial-receipt migration was already applied in some environments.
-- Patch the installed RPC there without changing the legacy OPEN-order
-- consistency constraint: received_document_id is only the terminal receipt.
do $$
declare
  current_definition text;
  patched_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.receive_production_order(jsonb)'::pg_catalog.regprocedure
  ) into current_definition;

  if pg_catalog.position(
    'set received_document_id = case when all_received then' in current_definition
  ) > 0 then
    null;
  else
    patched_definition := pg_catalog.replace(
      current_definition,
      'set received_document_id = (posted_document ->> ''id'')::uuid,',
      'set received_document_id = case when all_received then (posted_document ->> ''id'')::uuid else null end,'
    );
    if patched_definition = current_definition then
      raise exception using
        errcode = 'P0001',
        message = 'PARTIAL_RECEIPT_RPC_PATCH_TARGET_NOT_FOUND';
    end if;

    execute patched_definition;
  end if;
end;
$$;

commit;
