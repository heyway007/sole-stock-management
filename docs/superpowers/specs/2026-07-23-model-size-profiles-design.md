# Model-specific shoe size profiles and text size labels

## Objective

SOLE STOCK must support the size systems used by each shoe model while continuing
to preserve and operate on all existing stock, stock documents, and production
orders.

- Paris and Castor use apparel-style labels from `XS` through `3XL`.
- Weave uses EU labels from `39` through `45`.
- Staff can add a custom size containing numbers or letters.
- Selectors show fitting guidance, while operational tables and printed documents
  keep the size label concise.

This remains a shared, no-login workflow. Authentication and per-user permissions
are outside this change.

## Standard size profiles

### Paris and Castor

| Size label | EU range | Foot length |
| --- | --- | --- |
| XS | 36–37 | 22–22.5 cm |
| S | 37–38 | 23–23.5 cm |
| M | 39–40 | 24–24.5 cm |
| L | 40–41 | 25–25.5 cm |
| XL | 42–43 | 26–26.5 cm |
| 2XL | 44–45 | 27–27.5 cm |
| 3XL | 45–46 | 28–28.5 cm |

### Weave

| Size label | Foot length |
| --- | --- |
| 39 | 23–23.5 cm |
| 40 | 24–24.5 cm |
| 41 | 25–25.5 cm |
| 42 | 26–26.5 cm |
| 43 | 26.5–27 cm |
| 44 | 27–27.5 cm |
| 45 | 28–28.5 cm |

Profiles are selected by the normalized model name. A model outside Paris,
Castor, and Weave has no predefined guidance and continues to support custom
sizes.

## Data model

The canonical variant size becomes a normalized text label instead of a decimal
number.

- `ProductVariant.size`, document-line size inputs, production-order snapshot
  sizes, repository interfaces, selectors, and Supabase mappings use `string`.
- A valid size is a non-empty normalized label of at most 24 Unicode characters.
- Normalization trims leading and trailing whitespace, collapses internal
  whitespace runs to one space, and applies Unicode uppercase conversion.
- Control characters are rejected.
- Examples of valid normalized labels are `39`, `38.5`, `39-40`, `M/L`, `FREE`,
  `2XL`, and Thai text.
- Variant uniqueness is case-insensitive within a model and color. `xl`, `XL`,
  and ` XL ` refer to the same variant.
- Stock quantities remain positive whole-number pairs and are unchanged.

Fitting guidance is application metadata, not part of the stock identity. The
database stores the concise size label only. This prevents descriptive text
changes from creating a new stock variant.

## Existing data and migration

A new forward-only Supabase migration will update the deployed schema. Existing
migrations remain immutable.

1. Convert `product_variants.size` from numeric to text using a canonical decimal
   representation, so `38.0` becomes `38` and `38.5` remains `38.5`.
2. Convert `production_order_lines.size` the same way so historical production
   orders remain readable.
3. Replace the existing model-color-size unique constraint with a
   case-insensitive unique index based on the normalized size label.
4. Update inventory and production-order RPCs to accept, validate, compare, sort,
   and return size labels as text.
5. Replace `ensure_product_variant(uuid, uuid, numeric)` with the text-label
   implementation. Compatibility handling in stock-posting RPCs accepts both
   legacy JSON numbers and new JSON strings during deployment and normalizes
   both to a text label.
6. Add any missing standard variants for the configured Paris, Castor, and Weave
   model-color combinations with balance `0`.

No existing variant, balance, stock document, stock-document line, or production
order is deleted. Legacy sizes that are not in the new standard profile remain
available so staff can sell, exchange, count, and inspect old stock.

The demo repository follows the same rules. A fresh demo seed uses the new
model-specific profiles. Existing valid local demo snapshots are upgraded in
place from numeric sizes to normalized string labels instead of being discarded.

## User interface

### Selecting a size

After model and color are chosen, existing size variants remain selectable.
Known standard sizes include guidance in the selector:

- `M — EU 39–40 · 24–24.5 cm`
- `42 — 26–26.5 cm`

Legacy and custom sizes without guidance show only their concise label.

### Adding a custom size

The “เพิ่มไซซ์ใหม่” control changes from a numeric field to a text field.

- Mobile keyboards must permit letters and numbers.
- The field accepts standard and custom labels such as `FREE`, `M/L`, `39-40`,
  and `2XL`.
- The normalized value is shown before or after submission consistently.
- Empty, overlength, control-character, or duplicate values produce a Thai
  validation error beside the size field.
- Creating a custom size and posting its first receipt remain one workflow.

### Compact operational display

Inventory tables/cards, history details, issue and exchange forms, production
orders, and the A4 print/PDF output display only the concise label (`M`, `42`,
`FREE`). Guidance is limited to size selection so tables and printed documents
remain compact.

## Ordering

Size ordering is deterministic:

1. Profile sizes appear in the configured order:
   - Paris/Castor: `XS`, `S`, `M`, `L`, `XL`, `2XL`, `3XL`
   - Weave: `39`, `40`, `41`, `42`, `43`, `44`, `45`
2. Existing legacy and custom sizes follow the profile sizes.
3. Remaining labels use locale-aware natural ordering with numeric comparison,
   so `2XL` sorts before `10XL` and numeric labels remain intuitive.
4. Variant ID provides the final stable tie-breaker.

The same ordering is used in selectors, inventory results, production orders,
and print output where applicable.

## Error handling and compatibility

- Client validation rejects invalid labels before making repository calls.
- Demo and Supabase repositories repeat normalization and validation at their
  trust boundaries.
- Supabase RPCs raise stable validation errors for invalid or duplicate labels;
  the client maps them to Thai user-facing messages.
- Posting and receiving remain atomic. A rejected size cannot create a partial
  variant, balance, stock document, or production receipt.
- Idempotent stock documents and production-order receipts retain their existing
  request-ID behavior.
- Existing numeric API payloads are accepted by the posting RPC during rollout,
  preventing a short deployment overlap from breaking stock operations.

## Verification

Automated coverage must include:

- normalization of numbers, Latin letters, Thai text, whitespace, and casing;
- rejection of empty, overlength, control-character, and duplicate labels;
- profile metadata and ordering for Paris, Castor, and Weave;
- fresh demo seed variants and upgrade of a legacy numeric demo snapshot;
- custom text-size creation followed by an atomic first receipt;
- receive, issue, exchange, stock clearing, history, and low-stock selectors with
  string size labels;
- production-order create, edit, print, cancel, and receive flows with alphabetic
  sizes;
- Supabase mapping and migration contract tests, including preservation of
  existing records and compatibility with numeric JSON payloads;
- responsive selectors and concise labels in mobile cards and A4 print output;
- full unit/component suite, typecheck, lint, production build, and responsive
  Playwright E2E.

## Out of scope

- A user-editable size-profile administration screen;
- storing profile guidance as database-managed catalog records;
- automatically deleting or deactivating legacy sizes;
- converting one legacy size to a new profile size;
- authentication, roles, or per-user permissions;
- automatic shoe-size conversion beyond the supplied mappings.
