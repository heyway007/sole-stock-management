import type { Metadata } from "next";
import { Kanit } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { InventoryProvider } from "@/features/inventory/inventory-provider";
import { ProductionOrderProvider } from "@/features/production-orders/production-order-provider";
import "sweetalert2/dist/sweetalert2.min.css";
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
      <body className={kanit.variable}>
        <InventoryProvider>
          <ProductionOrderProvider>
            <AppShell>{children}</AppShell>
          </ProductionOrderProvider>
        </InventoryProvider>
      </body>
    </html>
  );
}
