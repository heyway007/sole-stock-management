# SOLE STOCK

ระบบจัดการสต็อกรองเท้าสำหรับพื้นที่ทำงานร่วมกัน สร้างด้วย Next.js, React และ TypeScript โดยเริ่มต้นใช้งานได้ทันทีในโหมดสาธิต และเลือกเชื่อมต่อ Supabase ได้ภายหลัง

## Prerequisites

- Node.js 20.9.0 ขึ้นไป
- npm
- Chromium สำหรับการทดสอบ E2E (`npx playwright install chromium` เมื่อติดตั้ง browser runtime ครั้งแรก)
- Supabase project และ Supabase CLI เฉพาะเมื่อต้องการใช้ backend แบบ Supabase

## Install and run

```powershell
npm install
npm run dev
```

เปิด [http://localhost:3000](http://localhost:3000) ในเบราว์เซอร์ แอปจะใช้ `demo` backend เป็นค่าเริ่มต้นโดยไม่ต้องสร้างไฟล์ environment

## Demo persistence and reset

โหมด `demo` เก็บ snapshot ทั้งหมดไว้ใน `localStorage` ของ browser ภายใต้ key `sole-stock.inventory.v1` ข้อมูลรับเข้า นำออก แลกเปลี่ยน เกณฑ์สต็อกต่ำ และการแก้ไขแค็ตตาล็อกจึงยังอยู่หลัง refresh แต่แยกกันตาม browser และ origin และไม่ได้ sync ระหว่างเครื่อง

เมื่อต้องการกลับไปใช้ข้อมูลตั้งต้น ให้เปิด DevTools แล้วลบ key `sole-stock.inventory.v1` จาก Local Storage (หรือ clear site data) จากนั้น reload หน้าเว็บ แอปจะสร้าง seeded inventory ใหม่โดยอัตโนมัติ การ reset นี้ลบเอกสารสาธิตทั้งหมดใน browser นั้น

คัดลอก `.env.example` เป็น `.env.local` เมื่อต้องการกำหนด environment เอง:

```powershell
Copy-Item .env.example .env.local
```

ตั้ง `NEXT_PUBLIC_INVENTORY_BACKEND=demo` หรือปล่อยค่า Supabase ว่างไว้เพื่อใช้ local demo ต่อไป

## Supabase setup and switching

1. สร้าง Supabase project สำหรับข้อมูลที่ไม่อ่อนไหว
2. Apply migration [`supabase/migrations/202607220001_inventory.sql`](supabase/migrations/202607220001_inventory.sql) ผ่าน SQL Editor ของ Supabase หรือ link project แล้วรัน:

   ```powershell
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```

3. กำหนด `.env.local` ดังนี้ แล้ว restart `npm run dev`:

   ```dotenv
   NEXT_PUBLIC_INVENTORY_BACKEND=supabase
   NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
   ```

Repository factory จะเลือก Supabase เฉพาะเมื่อ backend flag, URL และ anonymous key ครบทั้งสามค่า หากค่าใดหายไป แอปจะ fallback เป็น demo repository เพื่อคงค่าเริ่มต้นที่ปลอดภัยและเปิดใช้งานได้โดยไม่ต้องตั้งค่า

### Security limitation

Version one deliberately has no authentication, login, application roles, or user access restrictions. Anonymous and authenticated Supabase sessions receive the same open read/catalog access, so this setup is suitable only for non-sensitive, single-tenant/shared-workspace use. Do not publish it for sensitive or multi-tenant data without adding authentication and authorization.

Ledger tables are not directly writable by browser roles. Stock documents are posted through the open `post_stock_document` RPC, whose carefully owned `SECURITY DEFINER` function is only a database-integrity boundary: it validates and locks balances, prevents duplicate retries, and commits the document atomically. It does not identify or authorize users. Snapshot loading uses the open `get_inventory_snapshot` RPC so every catalog, balance, document, and line comes from one coherent uncapped PostgreSQL snapshot.

Posting retry identity is retained only within the current repository instance. If the browser fully reloads after an ambiguous network response, reload and reconcile against movement history before submitting again; a blind retry after reload receives a new request UUID.

## Test and verification commands

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npm run e2e
```

`npm run e2e` starts and stops its own demo-mode development server through Playwright and runs Chromium at 1440×900 and 390×844. Run only the inventory smoke spec with:

```powershell
npm run e2e -- tests/e2e/inventory.spec.ts
```

## Route map

| Route | Purpose |
| --- | --- |
| `/` | ภาพรวมยอดคงเหลือ สต็อกต่ำ และรายการล่าสุด |
| `/inventory` | ค้นหา กรอง ตรวจยอด และตั้งเกณฑ์สต็อกต่ำ |
| `/receive` | รับสินค้าหลาย variant ในเอกสารเดียว |
| `/issue` | บันทึกการขาย สินค้าชำรุด หรือปรับยอด |
| `/exchange` | รับคืนและส่งสินค้าทดแทนแบบ atomic exchange |
| `/history` | ตรวจเอกสารและ signed movement lines ย้อนหลัง |
| `/catalog` | เพิ่ม เปลี่ยนชื่อ เปิด หรือปิดใช้รุ่นและสี |
