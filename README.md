# SOLE STOCK

ระบบจัดการสต็อกรองเท้าสำหรับพื้นที่ทำงานร่วมกัน

## Persistence mode

The application starts in `demo` mode by default and stores data in the browser's local storage. Copy `.env.example` to `.env.local` when local overrides are needed.

Before changing `NEXT_PUBLIC_INVENTORY_BACKEND` to `supabase`, create a Supabase project, apply `supabase/migrations/202607220001_inventory.sql`, and provide both public Supabase values. The factory selects Supabase only when the backend flag, URL, and anonymous key are all present; otherwise it keeps the demo repository.

Version one deliberately has no authentication, login, application roles, or user access restrictions. Anonymous and authenticated Supabase sessions receive the same open read/catalog access, so this setup is suitable only for non-sensitive, single-tenant/shared-workspace use.

Ledger tables are not directly writable by browser roles. Stock documents are posted through the open `post_stock_document` RPC, whose carefully owned `SECURITY DEFINER` function is only a database-integrity boundary: it validates and locks balances, prevents duplicate retries, and commits the document atomically. It does not identify or authorize users. Snapshot loading uses the open `get_inventory_snapshot` RPC so every catalog, balance, document, and line comes from one coherent uncapped PostgreSQL snapshot.

Posting retry identity is retained only within the current repository instance. If the browser fully reloads after an ambiguous network response, reload and reconcile against movement history before submitting again; a blind retry after reload receives a new request UUID.
