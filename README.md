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

โหมด `demo` เก็บ snapshot ทั้งหมดไว้ใน `localStorage` ของ browser ภายใต้ key `sole-stock.inventory.v1` ข้อมูลรับเข้า นำออก แลกเปลี่ยน เกณฑ์สต็อกต่ำ และการแก้ไขแค็ตตาล็อกจึงยังอยู่หลัง refresh แต่แยกกันตาม browser และ origin และไม่ได้ sync ระหว่างเครื่อง แท็บที่เปิด origin เดียวกันจะรับการเปลี่ยนแปลงผ่าน storage event โดยอัตโนมัติ และ mutation จะใช้ Web Locks (เมื่อ browser รองรับ) พร้อม revision check เพื่อไม่ให้แท็บหนึ่งเขียนทับข้อมูลใหม่จากอีกแท็บ

เมื่อต้องการกลับไปใช้ข้อมูลตั้งต้น ให้เปิด DevTools แล้วลบ key `sole-stock.inventory.v1` จาก Local Storage (หรือ clear site data) จากนั้น reload หน้าเว็บ แอปจะสร้าง seeded inventory ใหม่โดยอัตโนมัติ การ reset นี้ลบเอกสารสาธิตทั้งหมดใน browser นั้น

คัดลอก `.env.example` เป็น `.env.local` เมื่อต้องการกำหนด environment เอง:

```powershell
Copy-Item .env.example .env.local
```

ตั้ง `NEXT_PUBLIC_INVENTORY_BACKEND=demo` หรือปล่อยค่า Supabase ว่างไว้เพื่อใช้ local demo ต่อไป

## Supabase setup and switching

1. สร้าง Supabase project สำหรับข้อมูลที่ไม่อ่อนไหว
2. Apply migration ใน [`supabase/migrations`](supabase/migrations) ตามลำดับชื่อไฟล์ รวม migration `202607230005_text_size_profiles.sql` ผ่าน SQL Editor ของ Supabase หรือ link project แล้วรัน:

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

### Shoe sizes and creating a new size

ไซซ์มาตรฐานของ Paris/Castor คือ XS–3XL และ Weave คือ 39–45 ช่องเลือกจะแสดงช่วง EU/ความยาวเท้าเพื่อช่วยเลือก แต่ตารางสต๊อก ประวัติ ใบผลิต และเอกสารพิมพ์จะแสดงชื่อไซซ์แบบสั้น

| Paris / Castor | EU | ความยาวฝ่าเท้า |
| --- | --- | --- |
| XS | 36–37 | 22–22.5 cm |
| S | 37–38 | 23–23.5 cm |
| M | 39–40 | 24–24.5 cm |
| L | 40–41 | 25–25.5 cm |
| XL | 42–43 | 26–26.5 cm |
| 2XL | 44–45 | 27–27.5 cm |
| 3XL | 45–46 | 28–28.5 cm |

| Weave | ความยาวฝ่าเท้า |
| --- | --- |
| 39 | 23–23.5 cm |
| 40 | 24–24.5 cm |
| 41 | 25–25.5 cm |
| 42 | 26–26.5 cm |
| 43 | 26.5–27 cm |
| 44 | 27–27.5 cm |
| 45 | 28–28.5 cm |

เมื่อต้องการไซซ์อื่น ให้เพิ่มรุ่นและสีที่หน้า `/catalog` ก่อน จากนั้นไปที่ `/receive` เลือกรุ่นและสี เลือก `เพิ่มไซซ์ใหม่` แล้วกรอกข้อความ เช่น `FREE`, `M/L`, `39-40`, `2XL` หรือภาษาไทย ระบบจะตัดช่องว่างส่วนเกิน ปรับตัวอักษรเป็นรูปแบบมาตรฐาน และจำกัดความยาว 24 ตัวอักษร การบันทึกจะสร้าง model-color-size variant ที่ยังไม่มีด้วยยอดตั้งต้น 0 แล้วรับสินค้าใน workflow เดียวกัน หาก variant เดิมมีอยู่แล้ว ระบบจะนำกลับมาใช้แทนการสร้างซ้ำ

ในโหมด Supabase การสร้าง variant ทำผ่าน `ensure_product_variant` RPC แบบ atomic และ idempotent ภายใต้ unique model-color-size constraint ส่วน browser roles ยังคงไม่มีสิทธิ์ insert ตาราง `product_variants` โดยตรง

### Security limitation

Version one deliberately has no authentication, login, application roles, or user access restrictions. Anonymous and authenticated Supabase sessions receive the same open read/catalog access, so this setup is suitable only for non-sensitive, single-tenant/shared-workspace use. Do not publish it for sensitive or multi-tenant data without adding authentication and authorization.

Ledger and variant tables are not directly writable by browser roles. Stock documents are posted through the open `post_stock_document` RPC, whose carefully owned `SECURITY DEFINER` function is only a database-integrity boundary: it validates and locks balances, prevents duplicate retries, and commits the document atomically. Variant creation uses the separately scoped `ensure_product_variant` RPC. Neither function identifies or authorizes users. Snapshot loading uses the open `get_inventory_snapshot` RPC so every catalog, balance, document, and line comes from one coherent uncapped PostgreSQL snapshot.

Supabase posting stores each pending payload fingerprint and request UUID as an isolated browser `localStorage` entry under the `sole-stock.supabase.pending-posts.v1` prefix, namespaced by Supabase URL. A Web Lock serializes cross-tab identity allocation. An ambiguous retry therefore reuses the same UUID even after repository reconstruction or a full reload, allowing `post_stock_document` to reconcile idempotently. The pending entry is removed after a confirmed response or after a coherent snapshot proves that the UUID already committed; an identical later business command then receives a fresh UUID. Clearing site data removes unresolved retry identities, so reconcile movement history before retrying any request that was in flight when storage was cleared.

## Test and verification commands

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npm run e2e
```

`npm run e2e` always starts and stops its own demo-mode development server on dedicated port `3100` through Playwright, with existing-server reuse disabled so an occupied port fails safely. It runs Chromium at 1440×900, 390×844, and the minimum supported 360×800 viewport. Run only the inventory smoke spec with:

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
| `/production-orders` | สร้าง แก้ไข พิมพ์ ยกเลิก และรับใบผลิตเข้าสต๊อก |
