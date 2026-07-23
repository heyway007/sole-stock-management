"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ProductionOrderActions } from "@/features/production-orders/components/production-order-actions";
import { ProductionOrderStatus } from "@/features/production-orders/components/production-order-status";
import { summarizeProductionOrder } from "@/features/production-orders/domain/selectors";
import {
  amountToMinor,
  formatBahtMinor,
  lineTotalMinor,
} from "@/features/production-orders/domain/money";
import { useProductionOrders } from "@/features/production-orders/production-order-provider";
import { useInventory } from "@/features/inventory/inventory-provider";

export function ProductionOrderDetailPageContent() {
  const params = useParams<{ id: string }>();
  const { orders, loading, error, warning, refresh, cancel, receive } = useProductionOrders();
  const inventory = useInventory();
  if (loading && !orders) return <div className="page-state" role="status">กำลังโหลดใบผลิต…</div>;
  if (error && !orders) {
    return <div className="page-state page-state--error" role="alert"><p>{error}</p><Button variant="secondary" onClick={() => void refresh()}>ลองใหม่</Button></div>;
  }
  const order = orders?.find((candidate) => candidate.id === params.id);
  if (!order) {
    return <div className="page-state"><div><h1>ไม่พบใบผลิต</h1><Link className="button button--primary" href="/production-orders">กลับหน้ารายการ</Link></div></div>;
  }

  const summary = summarizeProductionOrder(order);
  const receipt = order.receivedDocumentId
    ? inventory.snapshot?.documents.find((document) => document.id === order.receivedDocumentId)
    : undefined;

  return (
    <div className="page-container production-order-detail-page">
      <Link className="production-detail-back" href="/production-orders"><ArrowLeft aria-hidden size={17} />กลับหน้ารายการ</Link>
      <header className="page-header production-detail-header">
        <div>
          <p className="eyebrow">รายละเอียดใบผลิต</p>
          <h1>{order.number}</h1>
          <p>สร้างเมื่อ {order.createdAt}</p>
        </div>
        <ProductionOrderStatus status={order.status} />
      </header>
      {warning && <div className="repository-status-banner" role="alert">{warning}</div>}

      <ProductionOrderActions order={order} onCancel={cancel} onReceive={receive} />

      <section className="production-detail-card" aria-label="ข้อมูลใบผลิต">
        <dl className="production-detail-metadata">
          <div><dt>วันที่สั่งผลิต</dt><dd>{order.orderDate}</dd></div>
          <div><dt>วันที่กำหนดรับ</dt><dd>{order.expectedDate}</dd></div>
          <div><dt>จำนวนรายการ</dt><dd>{summary.lineCount} รายการ</dd></div>
          <div><dt>จำนวนทั้งหมด</dt><dd>{summary.totalPairs} คู่</dd></div>
          {order.receivedAt && <div><dt>รับเข้าสต๊อกเมื่อ</dt><dd>{order.receivedAt}</dd></div>}
          {order.cancelledAt && <div><dt>ยกเลิกเมื่อ</dt><dd>{order.cancelledAt}</dd></div>}
          {order.receivedDocumentId && (
            <div className="production-receipt-reference">
              <dt>เอกสารรับเข้า</dt>
              <dd><Link href={`/history?document=${encodeURIComponent(order.receivedDocumentId)}`}>{receipt?.number ?? "เปิดเอกสารรับเข้า"}</Link></dd>
            </div>
          )}
        </dl>
        <div className="production-detail-note"><strong>หมายเหตุ</strong><p>{order.note || "—"}</p></div>
      </section>

      <section className="production-detail-lines" aria-label="รายการสินค้าในใบผลิต">
        <div className="inventory-table-wrap production-detail-table-wrap">
          <table className="inventory-table" aria-label="รายการในใบผลิต">
            <thead><tr><th>#</th><th>รุ่น</th><th>สี</th><th>ไซซ์</th><th>จำนวน</th><th>ราคา/หน่วย</th><th>จำนวนเงิน</th></tr></thead>
            <tbody>{order.lines.map((line) => (
              <tr key={line.id}>
                <td>{line.lineNumber}</td>
                <td><strong>{line.modelName}</strong></td>
                <td>{line.colorName}</td>
                <td>{line.size}</td>
                <td><strong>{line.quantity}</strong> คู่</td>
                <td className="production-money-cell">{formatBahtMinor(amountToMinor(line.unitPrice))}</td>
                <td className="production-money-cell">{formatBahtMinor(lineTotalMinor(line.quantity, line.unitPrice))}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div className="production-detail-line-cards" role="list" aria-label="รายการในใบผลิตสำหรับมือถือ">
          {order.lines.map((line) => (
            <article role="listitem" key={line.id}>
              <div>
                <strong>{line.modelName} / {line.colorName}</strong>
                <span>ไซซ์ {line.size}</span>
                <span>ราคา/หน่วย {formatBahtMinor(amountToMinor(line.unitPrice))}</span>
              </div>
              <div className="production-card-amount">
                <span>{line.quantity} คู่</span>
                <strong>{formatBahtMinor(lineTotalMinor(line.quantity, line.unitPrice))}</strong>
              </div>
            </article>
          ))}
        </div>
        <footer>
          <span>รวม {summary.lineCount} รายการ · {summary.totalPairs} คู่</span>
          <strong>ยอดรวมสุทธิ {formatBahtMinor(summary.totalAmountMinor)}</strong>
          {!summary.hasCompletePricing && <small>ข้อมูลราคายังไม่ครบ</small>}
        </footer>
      </section>
    </div>
  );
}

export default function ProductionOrderDetailPage() {
  return <ProductionOrderDetailPageContent />;
}
