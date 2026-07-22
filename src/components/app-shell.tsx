"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  Boxes,
  History,
  LayoutDashboard,
  Settings2,
} from "lucide-react";
import type { ComponentType, PropsWithChildren } from "react";

interface NavigationItem {
  href: string;
  label: string;
  icon: ComponentType<{ "aria-hidden"?: boolean; size?: number; strokeWidth?: number }>;
}

const navigationItems: NavigationItem[] = [
  { href: "/", label: "ภาพรวม", icon: LayoutDashboard },
  { href: "/inventory", label: "สินค้าคงคลัง", icon: Boxes },
  { href: "/receive", label: "รับสินค้า", icon: ArrowDownToLine },
  { href: "/issue", label: "นำสินค้าออก", icon: ArrowUpFromLine },
  { href: "/exchange", label: "เปลี่ยนสินค้า", icon: ArrowLeftRight },
  { href: "/history", label: "ประวัติ", icon: History },
  { href: "/catalog", label: "จัดการสินค้า", icon: Settings2 },
];

function isCurrentPath(pathname: string, href: string): boolean {
  return href === "/" ? pathname === href : pathname.startsWith(href);
}

function NavigationLinks({ pathname, mobile = false }: { pathname: string; mobile?: boolean }) {
  return navigationItems.map(({ href, label, icon: Icon }) => {
    const current = isCurrentPath(pathname, href);
    return (
      <Link
        className={`${mobile ? "mobile-nav__link" : "sidebar-nav__link"}${current ? " is-active" : ""}`}
        href={href}
        key={href}
        aria-current={current ? "page" : undefined}
      >
        <Icon aria-hidden size={mobile ? 20 : 19} strokeWidth={1.9} />
        <span>{label}</span>
      </Link>
    );
  });
}

export function AppShell({ children }: PropsWithChildren) {
  const pathname = usePathname();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden>SS</span>
          <span><strong>SOLE STOCK</strong><small>ระบบจัดการสต็อก</small></span>
        </div>
        <nav className="sidebar-nav" aria-label="เมนูหลัก">
          <NavigationLinks pathname={pathname} />
        </nav>
        <div className="demo-badge"><span aria-hidden />โหมดสาธิต</div>
      </aside>

      <main className="app-main">{children}</main>

      <nav className="mobile-nav" aria-label="เมนูมือถือ">
        <div className="mobile-nav__scroller">
          <NavigationLinks pathname={pathname} mobile />
        </div>
      </nav>
    </div>
  );
}
