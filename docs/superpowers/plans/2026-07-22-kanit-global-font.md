# Kanit Global Font Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply Kanit to every SOLE STOCK interface element without changing layout or application behavior.

**Architecture:** Configure Kanit once with `next/font/google` in the root layout and expose it through the `--font-kanit` CSS variable. The global body font stack consumes that variable, while existing form controls continue inheriting the body font.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, CSS, Vitest, Testing Library, Playwright

## Global Constraints

- Use Kanit for navigation, headings, tables, forms, buttons, badges, and mobile controls.
- Load Latin and Thai subsets with weights 400, 500, 600, 700, 800, and 900.
- Use `display: "swap"` and CSS variable `--font-kanit`.
- Retain the existing Thai-capable system fallback stack.
- Do not change typography sizes, spacing, colors, dimensions, breakpoints, content, or application behavior.
- Preserve the existing uncommitted `next-env.d.ts` change and do not stage it.

---

### Task 1: Wire Kanit through the root layout and global styles

**Files:**
- Create: `tests/unit/layout-font.test.tsx`
- Modify: `tests/e2e/inventory.spec.ts`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `Kanit(options)` from `next/font/google`.
- Produces: a `--font-kanit` CSS variable class on `<body>` and a global Kanit-first font stack inherited by controls.

- [ ] **Step 1: Write the failing layout and browser assertions**

Create `tests/unit/layout-font.test.tsx`:

```tsx
const { kanitMock } = vi.hoisted(() => ({
  kanitMock: vi.fn(() => ({
    className: "kanit-class",
    style: { fontFamily: "Kanit" },
    variable: "kanit-variable",
  })),
}));

vi.mock("next/font/google", () => ({ Kanit: kanitMock }));

import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import RootLayout from "@/app/layout";

describe("RootLayout typography", () => {
  it("configures Kanit and exposes its CSS variable on the body", () => {
    const layout = RootLayout({ children: <p>เนื้อหา</p> });
    const body = layout.props.children as ReactElement<{ className?: string }>;

    expect(kanitMock).toHaveBeenCalledWith({
      subsets: ["latin", "thai"],
      weight: ["400", "500", "600", "700", "800", "900"],
      display: "swap",
      variable: "--font-kanit",
    });
    expect(body.type).toBe("body");
    expect(body.props.className).toBe("kanit-variable");
  });
});
```

In `tests/e2e/inventory.spec.ts`, immediately after `await resetDemoStorage(page);`, add:

```ts
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).fontFamily))
    .toContain("Kanit");
```

- [ ] **Step 2: Run the new assertions and verify RED**

Run:

```powershell
npm test -- tests/unit/layout-font.test.tsx
npm run e2e -- tests/e2e/inventory.spec.ts
```

Expected: the unit test fails because `next/font/google` is not imported and the body has no Kanit class; the E2E test fails because the computed body font is the existing Noto Sans Thai/system stack.

- [ ] **Step 3: Implement the minimal global font wiring**

Update `src/app/layout.tsx` to import and configure Kanit once:

```tsx
import type { Metadata } from "next";
import { Kanit } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { InventoryProvider } from "@/features/inventory/inventory-provider";
import "./globals.css";

const kanit = Kanit({
  subsets: ["latin", "thai"],
  weight: ["400", "500", "600", "700", "800", "900"],
  display: "swap",
  variable: "--font-kanit",
});

export const metadata: Metadata = {
  title: "SOLE STOCK | ระบบจัดการสต็อกรองเท้า",
  description: "ระบบจัดการสต็อกรองเท้า SOLE STOCK",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <body className={kanit.variable}><InventoryProvider><AppShell>{children}</AppShell></InventoryProvider></body>
    </html>
  );
}
```

Update the existing `body` rule in `src/app/globals.css`:

```css
body {
  margin: 0;
  color: var(--ink);
  background: var(--canvas);
  font-family: var(--font-kanit), "Noto Sans Thai", "Leelawadee UI", Tahoma, system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}
```

- [ ] **Step 4: Verify GREEN and all regression checks**

Run:

```powershell
npm test -- tests/unit/layout-font.test.tsx
npm test
npm run typecheck
npm run lint
npm run build
npm run e2e -- tests/e2e/inventory.spec.ts
```

Expected: 24 Vitest files and 148 tests pass, TypeScript and ESLint exit with code 0, the production build generates all nine routes, and Playwright passes at 1440×900, 390×844, and 360×800 without horizontal overflow.

- [ ] **Step 5: Review and commit only the font implementation files**

Run:

```powershell
git diff --check
git status --short
git add src/app/layout.tsx src/app/globals.css tests/unit/layout-font.test.tsx tests/e2e/inventory.spec.ts
git diff --cached --check
git commit -m "feat: apply Kanit across the interface"
```

Expected: the commit contains only the four implementation/test files. `next-env.d.ts` remains unstaged.
