# Shoe Inventory Management System Design

## Objective

Build a responsive Thai-language shoe inventory application with Next.js. The application records stock receipts, stock issues, and customer exchanges; preserves a complete movement history; warns about low stock; works immediately in a browser-backed demo mode; and is ready to switch to PostgreSQL on Supabase.

Version one is a shared workspace without authentication or role-based access.

## Product Catalog

The initial catalog contains:

| Model | Colors |
| --- | --- |
| Paris | Black, Navy, Olive |
| Castor | Black, Brown, Olive |
| Weave | Black, Brown, Sand |

Users can add and edit models and colors. Catalog values referenced by historical movements are deactivated instead of deleted. Sizes are decimal numbers, including whole and half sizes such as `38` and `38.5`. Quantities represent pairs and must be positive whole numbers.

## Chosen Approach

Use an inventory ledger plus a current-balance projection. Every receipt, issue, adjustment, and exchange creates an immutable stock document with one or more lines. Posting the document updates every affected balance atomically. If any outgoing line would make a balance negative, neither the document nor any balance update is committed.

Historical documents are never edited or deleted. Corrections are represented by new adjustment documents. This preserves an auditable explanation for every current balance.

## Technical Architecture

- Next.js App Router with TypeScript for the application runtime.
- Tailwind CSS for responsive layout and visual styling.
- Feature-oriented React components for dashboard, inventory, receiving, issuing, exchanges, history, and catalog management.
- An `InventoryRepository` interface separates UI and domain behavior from persistence.
- A browser `localStorage` repository provides a fully usable demo without credentials.
- A Supabase repository uses PostgreSQL when the required public environment variables are present.
- PostgreSQL functions post stock documents atomically and enforce stock constraints at the database boundary.

The UI and domain services consume only `InventoryRepository`. Switching repository implementations does not change page components or business rules.

## Data Model

### Catalog

- `shoe_models`: model name, active status, timestamps.
- `colors`: color name, active status, timestamps.
- `product_variants`: model, color, decimal size, low-stock threshold, active status, timestamps. The tuple `(model_id, color_id, size)` is unique.

### Inventory

- `inventory_balances`: one row per variant with a non-negative integer quantity.
- `stock_documents`: document number, movement type, effective date, optional reference, optional note, and creation timestamp.
- `stock_document_lines`: parent document, variant, signed integer quantity change, and optional line note.

Movement types are:

- `RECEIPT`: positive lines for stock received.
- `SALE`: negative lines for sold stock.
- `DAMAGE`: negative lines for damaged stock.
- `ADJUSTMENT`: positive or negative lines used to correct a count.
- `EXCHANGE`: positive return lines and negative replacement lines in one document.

An exchange must contain at least one positive return line and one negative replacement line. All lines post in a single transaction.

## Screens and Navigation

The selected visual direction is **Operations Dashboard**: a desktop sidebar and a compact mobile bottom navigation. Desktop layouts favor overview and data density; mobile layouts use large touch targets and single-column forms.

### Dashboard

- Total pairs currently in stock.
- Pairs received and issued during the current month.
- Number of variants at or below their configured threshold.
- Quick actions for receipt, issue, and exchange.
- Low-stock list and recent movement list.

### Inventory

- Search by model, color, or size.
- Filter by model, color, and stock status.
- Desktop data table and mobile inventory cards.
- Edit the low-stock threshold for a variant.
- Open the movement history for a selected variant.

### Receive Stock

- Effective date, optional external reference, and optional note.
- Multiple rows per document.
- Each row selects model, color, decimal size, and positive whole-pair quantity.
- Duplicate variants in the same document are rejected with a Thai validation message.

### Issue Stock

- Effective date, optional external reference, and optional note.
- A required reason: sale, damage, or adjustment.
- Multiple rows per document.
- Available stock is shown beside each selected variant.
- Submission is blocked if any outgoing row exceeds available stock.

Positive count corrections use the adjustment flow and negative count corrections use the same flow with direction made explicit in the UI.

### Exchange Stock

- Effective date, optional reference, and optional note.
- A returned-items section adds the old pair or pairs back to stock.
- A replacement-items section removes the new pair or pairs from stock.
- The preview summarizes net changes before confirmation.
- Return and replacement lines are committed together or not at all.

### Movement History

- Filter by movement type and date range.
- Search by document number, external reference, model, color, or size.
- Open an immutable document detail view showing all lines and resulting quantity changes.

### Catalog Management

- Add and rename models and colors.
- Activate or deactivate catalog values.
- Add variants through the inventory workflow when a new model-color-size combination is first needed.
- Seed Paris, Castor, and Weave with the specified colors.

## Data Flow

1. A user opens a workflow and adds one or more valid rows.
2. Client-side validation catches missing values, duplicate variants, invalid sizes, and invalid quantities.
3. The domain service converts form values into a stock-document command.
4. The active repository posts the command.
5. Demo mode validates and updates a versioned `localStorage` snapshot atomically in memory before persisting it.
6. Supabase mode calls one PostgreSQL function that locks affected balance rows, validates every outgoing quantity, inserts the document and lines, updates balances, and commits.
7. On success, cached queries refresh and the UI shows a Thai success toast plus the document number.
8. On failure, the form retains its values and shows a Thai error message without changing stock.

## Validation and Error Handling

- Size must be a positive decimal value.
- Movement quantity must be a positive whole number of pairs.
- A document must contain at least one line.
- A variant cannot appear twice within the same section of a document.
- Current quantity can never be negative.
- Exchange documents require both a returned and replacement section.
- Catalog names are trimmed and compared case-insensitively to prevent duplicates.
- Unsaved forms warn before in-app navigation or browser exit.
- Loading, empty, offline-demo, and Supabase connection-error states have explicit Thai copy.
- Repository errors are mapped to actionable Thai messages; raw database details are not shown to users.

## Responsive and Accessibility Requirements

- Support screen widths from 360 px mobile to large desktop monitors.
- Use a persistent sidebar at desktop widths and bottom navigation on mobile.
- Convert inventory and history tables to readable cards on narrow screens.
- Keep primary touch targets at least 44 by 44 CSS pixels.
- Associate labels and error descriptions with every input.
- Support keyboard navigation and visible focus states.
- Do not communicate low-stock or error state by color alone.

## Supabase Readiness

The repository includes:

- SQL migrations for tables, constraints, indexes, database functions, and seed data.
- A typed Supabase client created only when required environment variables are available.
- `.env.example` documenting the public Supabase URL and anonymous key.
- An environment-controlled repository factory that selects Supabase or demo mode.
- Row Level Security policies suitable for the version-one shared client. Because version one has no login, production deployment must add authentication before storing sensitive or multi-tenant data.

## Testing Strategy

- Unit tests for document validation, decimal sizes, duplicate detection, low-stock classification, and stock calculations.
- Repository contract tests run against the demo repository.
- Tests proving failed issues do not partially update balances.
- Tests proving exchanges add returned stock and remove replacement stock atomically.
- Component tests for multi-line receipt, issue reason selection, exchange validation, search, and filters.
- Responsive smoke tests at representative mobile and desktop viewports.
- Final verification includes type checking, linting, unit/component tests, production build, and visual checks of core screens.

## Out of Scope for Version One

- Authentication, roles, and per-user audit identities.
- Multiple branches or warehouses.
- Pricing, purchasing, suppliers, customers, payments, and sales reporting.
- Barcode scanning, image uploads, and notifications outside the dashboard.
- Approval states such as draft, reviewed, or approved.

The data model leaves room to add actor identity and warehouse scope in later versions without changing historical document semantics.

## Success Criteria

- A new user can launch the project without Supabase credentials and use seeded demo data.
- Users can manage models and colors, including the provided initial catalog.
- Users can receive multiple variants in one document.
- Users can issue multiple variants for sale, damage, or adjustment without creating negative stock.
- Users can exchange returned and replacement variants in one atomic operation.
- Dashboard totals, low-stock warnings, inventory search, and movement history reflect posted documents.
- Core workflows remain usable at 360 px and desktop widths.
- Adding valid Supabase credentials switches persistence without changing application screens.
