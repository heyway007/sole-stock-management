"use client";

import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { summarizeProductionOrder } from "../domain/selectors";
import type { ProductionOrder } from "../domain/types";

const statusLabels = {
  OPEN: "รอรับเข้า",
  RECEIVED: "รับเข้าแล้ว",
  CANCELLED: "ยกเลิก",
} as const;

export function ProductionOrderPrint({ order }: { order: ProductionOrder }) {
  const summary = summarizeProductionOrder(order);
  return (
    <div className="production-print-preview">
      <div className="print-controls print-hidden">
        <Link className="button button--secondary" href={`/production-orders/${order.id}`}>
          <ArrowLeft aria-hidden size={17} />กลับไปใบผลิต
        </Link>
        <Button onClick={() => window.print()}><Printer aria-hidden size={17} />พิมพ์ใบผลิต</Button>
      </div>

      <article className="production-print-page">
        <header className="production-print-header">
          <div className="production-print-brand"><strong>SOLE STOCK</strong><span>ระบบจัดการสต๊อกรองเท้า</span></div>
          <div className="production-print-title"><h1>ใบผลิตออเดอร์</h1><strong>{order.number}</strong></div>
        </header>

        <section className="production-print-metadata" aria-label="ข้อมูลใบผลิตสำหรับพิมพ์">
          <div><span>วันที่สั่งผลิต</span><strong>{order.orderDate}</strong></div>
          <div><span>วันที่กำหนดรับ</span><strong>{order.expectedDate}</strong></div>
          <div><span>สถานะ</span><strong>{statusLabels[order.status]}</strong></div>
          <div><span>จำนวนทั้งหมด</span><strong>{summary.totalPairs} คู่</strong></div>
        </section>

        <table className="production-print-table" aria-label="รายการสั่งผลิต">
          <thead><tr><th>#</th><th>รุ่น</th><th>สี</th><th>ไซซ์</th><th>จำนวน (คู่)</th></tr></thead>
          <tbody>{order.lines.map((line) => (
            <tr key={line.id}>
              <td>{line.lineNumber}</td>
              <td>{line.modelName}</td>
              <td>{line.colorName}</td>
              <td>{line.size}</td>
              <td>{line.quantity}</td>
            </tr>
          ))}</tbody>
          <tfoot><tr><td colSpan={4}>รวมทั้งหมด</td><td>{summary.totalPairs} คู่</td></tr></tfoot>
        </table>

        <section className="production-print-note" aria-label="หมายเหตุ">
          <strong>หมายเหตุ</strong><p>{order.note || "—"}</p>
        </section>
        <p className="production-print-total">รวมทั้งหมด {summary.totalPairs} คู่</p>

        <footer className="production-print-signatures">
          <div><span className="signature-line" /><strong>ผู้สั่งผลิต</strong><small>วันที่ ______ / ______ / ______</small></div>
          <div><span className="signature-line" /><strong>ผู้รับออเดอร์</strong><small>วันที่ ______ / ______ / ______</small></div>
        </footer>
      </article>
    </div>
  );
}
