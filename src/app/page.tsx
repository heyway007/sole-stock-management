"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpFromLine,
  Boxes,
  PackageCheck,
} from "lucide-react";
import { InventoryProvider, useInventory } from "@/features/inventory/inventory-provider";
import { selectDashboardSummary, selectLowStock } from "@/features/inventory/domain/selectors";
import type { MovementType } from "@/features/inventory/domain/types";
import { StockStatus } from "@/features/inventory/components/stock-status";

const movementLabels: Record<MovementType, string> = {
  RECEIPT: "รับสินค้า",
  SALE: "ขายสินค้า",
  DAMAGE: "สินค้าชำรุด",
  ADJUSTMENT: "ปรับยอด",
  EXCHANGE: "เปลี่ยนสินค้า",
};

const quickActions = [
  { href: "/receive", label: "รับสินค้า", helper: "เพิ่มสินค้าเข้าสต็อก", icon: ArrowDownToLine },
  { href: "/issue", label: "นำสินค้าออก", helper: "ขาย ชำรุด หรือปรับยอด", icon: ArrowUpFromLine },
  { href: "/exchange", label: "เปลี่ยนสินค้า", helper: "รับคืนและส่งคู่ใหม่", icon: ArrowLeftRight },
] as const;

export function formatDashboardDate(date: Date): string {
  return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

export function getDashboardDate(date: Date): { dateTime: string; label: string } {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return { dateTime: `${year}-${month}-${day}`, label: formatDashboardDate(date) };
}

export function Dashboard() {
  const { snapshot, loading, error } = useInventory();

  if (loading) {
    return <div className="page-state" role="status">กำลังโหลดข้อมูลสต็อก…</div>;
  }

  if (error) {
    return <div className="page-state page-state--error" role="alert">{error}</div>;
  }

  if (!snapshot) {
    return <div className="page-state" role="status">ยังไม่มีข้อมูลสต็อก</div>;
  }

  const summary = selectDashboardSummary(snapshot);
  const lowStock = selectLowStock(snapshot).slice(0, 5);
  const recentDocuments = [...snapshot.documents]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 5);
  const today = getDashboardDate(new Date());
  const kpis = [
    { label: "สินค้าคงเหลือ", value: summary.totalOnHand, icon: Boxes, tone: "green" },
    { label: "รับเข้าเดือนนี้", value: summary.receivedThisMonth, icon: ArrowDownToLine, tone: "green" },
    { label: "นำออกเดือนนี้", value: summary.issuedThisMonth, icon: ArrowUpFromLine, tone: "orange" },
    { label: "สต๊อกต่ำ", value: summary.lowStockCount, icon: AlertTriangle, tone: "orange" },
  ] as const;

  return (
    <div className="page-container dashboard-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">ภาพรวมวันนี้</p>
          <h1>ภาพรวมสต็อก</h1>
          <p>ติดตามสินค้าและจัดการงานประจำวันได้จากที่เดียว</p>
        </div>
        <time className="header-date" dateTime={today.dateTime}>{today.label}</time>
      </header>

      <section className="kpi-grid" aria-label="สรุปสต็อก">
        {kpis.map(({ label, value, icon: Icon, tone }) => (
          <article className={`kpi-card kpi-card--${tone}`} key={label}>
            <div className="kpi-card__icon"><Icon aria-hidden size={22} /></div>
            <p>{label}</p>
            <strong>{value.toLocaleString("th-TH")}</strong>
            <small>คู่</small>
          </article>
        ))}
      </section>

      <section className="quick-actions" aria-labelledby="quick-actions-title">
        <div className="section-heading">
          <div><p className="eyebrow">ทางลัด</p><h2 id="quick-actions-title">จัดการสต็อก</h2></div>
        </div>
        <div className="quick-actions__grid">
          {quickActions.map(({ href, label, helper, icon: Icon }, index) => (
            <Link className={`quick-action${index === 2 ? " quick-action--accent" : ""}`} href={href} key={href}>
              <span className="quick-action__icon"><Icon aria-hidden size={22} /></span>
              <span><strong>{label}</strong><small>{helper}</small></span>
              <ArrowRight aria-hidden size={19} />
            </Link>
          ))}
        </div>
      </section>

      <div className="dashboard-columns">
        <section className="content-card" aria-labelledby="low-stock-title" aria-label="สินค้าที่ต้องเติม">
          <div className="section-heading">
            <div><p className="eyebrow">เฝ้าระวัง</p><h2 id="low-stock-title">สินค้าที่ต้องเติม</h2></div>
            <Link href="/inventory">ดูทั้งหมด <ArrowRight aria-hidden size={16} /></Link>
          </div>
          {lowStock.length ? (
            <div className="dashboard-list">
              {lowStock.map((row) => (
                <article className="stock-row" key={row.variantId}>
                  <div className="stock-row__mark"><PackageCheck aria-hidden size={19} /></div>
                  <div className="stock-row__copy">
                    <strong>{row.modelName} / {row.colorName}</strong>
                    <small>ไซซ์ {row.size}</small>
                  </div>
                  <div className="stock-row__quantity"><strong>{row.quantity}</strong><small>คู่</small></div>
                  <StockStatus status={row.status} />
                </article>
              ))}
            </div>
          ) : <p className="compact-empty">สินค้าอยู่ในระดับปกติทั้งหมด</p>}
        </section>

        <section className="content-card" aria-labelledby="recent-title" aria-label="รายการล่าสุด">
          <div className="section-heading">
            <div><p className="eyebrow">ความเคลื่อนไหว</p><h2 id="recent-title">รายการล่าสุด</h2></div>
            <Link href="/history">ดูทั้งหมด <ArrowRight aria-hidden size={16} /></Link>
          </div>
          {recentDocuments.length ? (
            <div className="dashboard-list">
              {recentDocuments.map((document) => (
                <article className="movement-row" key={document.id}>
                  <span className={`movement-row__icon movement-row__icon--${document.type.toLowerCase()}`}>
                    {document.type === "RECEIPT" ? <ArrowDownToLine aria-hidden size={18} /> : <ArrowUpFromLine aria-hidden size={18} />}
                  </span>
                  <div><strong>{movementLabels[document.type]}</strong><small>{document.number}</small></div>
                  <time dateTime={document.effectiveDate}>{new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short" }).format(new Date(`${document.effectiveDate}T12:00:00`))}</time>
                </article>
              ))}
            </div>
          ) : <p className="compact-empty">ยังไม่มีรายการเคลื่อนไหว</p>}
        </section>
      </div>
    </div>
  );
}

export default function Home() {
  return <>
    <span className="sr-only">ยินดีต้อนรับสู่ SOLE STOCK</span>
    <InventoryProvider><Dashboard /></InventoryProvider>
  </>;
}
