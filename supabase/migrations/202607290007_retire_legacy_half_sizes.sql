begin;

update public.product_variants
set active = false,
    updated_at = pg_catalog.statement_timestamp()
where size in ('38.5', '43.5');

alter table public.product_variants
  add constraint product_variants_retired_half_sizes_inactive
  check (not (active and size in ('38.5', '43.5')));

commit;
