import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SOLE STOCK | ระบบจัดการสต็อกรองเท้า",
  description: "ระบบจัดการสต็อกรองเท้า SOLE STOCK",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
