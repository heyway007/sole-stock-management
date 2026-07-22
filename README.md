# SOLE STOCK

ระบบจัดการสต็อกรองเท้าสำหรับพื้นที่ทำงานร่วมกัน

## Persistence mode

The application starts in `demo` mode by default and stores data in the browser's local storage. Copy `.env.example` to `.env.local` when local overrides are needed.

Before changing `NEXT_PUBLIC_INVENTORY_BACKEND` to `supabase`, create a Supabase project, apply `supabase/migrations/202607220001_inventory.sql`, and provide both public Supabase values. The factory selects Supabase only when the backend flag, URL, and anonymous key are all present; otherwise it keeps the demo repository.

Version one deliberately has no authentication. Its anonymous database policies are suitable only for non-sensitive, single-tenant/shared-workspace use and must be replaced before a sensitive or multi-tenant deployment.
