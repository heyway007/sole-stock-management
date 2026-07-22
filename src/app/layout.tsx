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
