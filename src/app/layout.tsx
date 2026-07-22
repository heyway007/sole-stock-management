import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { InventoryProvider } from "@/features/inventory/inventory-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "SOLE STOCK | ระบบจัดการสต็อกรองเท้า",
  description: "ระบบจัดการสต็อกรองเท้า SOLE STOCK",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <body><InventoryProvider><AppShell>{children}</AppShell></InventoryProvider></body>
    </html>
  );
}
