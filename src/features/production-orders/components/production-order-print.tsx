"use client";

import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PRODUCTION_COMPANY_PROFILE as profile } from "../company-profile";
import {
  amountToMinor,
  formatBahtMinor,
  lineTotalMinor,
} from "../domain/money";
import { summarizeProductionOrder } from "../domain/selectors";
import type { ProductionOrder } from "../domain/types";

const statusLabels = {
  OPEN: "รอรับเข้า",
  RECEIVED: "รับเข้าแล้ว",
  CANCELLED: "ยกเลิก",
} as const;

function amountWithoutUnit(value: number | null): string {
  return formatBahtMinor(value).replace(/ บาท$/, "");
}

export function ProductionOrderPrint({ order }: { order: ProductionOrder }) {
  const summary = summarizeProductionOrder(order);

  return (
    <div className="production-print-preview">
      <div className="print-controls print-hidden">
        <Link className="button button--secondary" href={`/production-orders/${order.id}`}>
          <ArrowLeft aria-hidden size={17} />กลับไปใบผลิต
        </Link>
        <Button onClick={() => window.print()}>
          <Printer aria-hidden size={17} />พิมพ์ใบผลิต
        </Button>
      </div>

      <article className="production-print-page">
        <header className="production-print-header">
          <section className="production-print-company" aria-label="ข้อมูลบริษัท">
            <strong>{profile.englishName}</strong>
            <h2>{profile.thaiName}</h2>
            <address>
              <p>{profile.address}</p>
              <p>โทร. {profile.phone}</p>
              <p>Line: {profile.line}</p>
              <p>{profile.email}</p>
            </address>
          </section>

          <section className="production-print-document" aria-label="ข้อมูลเอกสาร">
            <h1>ใบสั่งผลิต</h1>
            <dl>
              <div><dt>เลขที่</dt><dd>{order.number}</dd></div>
              <div><dt>วันที่สั่งผลิต</dt><dd>{order.orderDate}</dd></div>
              <div><dt>วันที่กำหนดรับ</dt><dd>{order.expectedDate}</dd></div>
              <div><dt>สถานะ</dt><dd>{statusLabels[order.status]}</dd></div>
            </dl>
          </section>
        </header>

        <table className="production-print-table" aria-label="รายการสั่งผลิต">
          <thead>
            <tr>
              <th>#</th>
              <th>รุ่นสินค้า</th>
              <th>รายละเอียด สี/ไซซ์</th>
              <th>จำนวน</th>
              <th>ราคา/หน่วย</th>
              <th>จำนวนเงิน</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((line) => (
              <tr key={line.id}>
                <td>{line.lineNumber}</td>
                <td>{line.modelName}</td>
                <td>{line.colorName} / {line.size}</td>
                <td>{line.quantity}</td>
                <td>{amountWithoutUnit(amountToMinor(line.unitPrice))}</td>
                <td>{amountWithoutUnit(lineTotalMinor(line.quantity, line.unitPrice))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>รวมจำนวน</td>
              <td>{summary.totalPairs} คู่</td>
              <td>ยอดรวมสุทธิ</td>
              <td>{formatBahtMinor(summary.totalAmountMinor)}</td>
            </tr>
          </tfoot>
        </table>

        <section className="production-print-summary" aria-label="สรุปยอดใบสั่งผลิต">
          <strong>รวมจำนวน {summary.totalPairs} คู่</strong>
          <strong>ยอดรวมสุทธิ {formatBahtMinor(summary.totalAmountMinor)}</strong>
          {!summary.hasCompletePricing && <small>ข้อมูลราคายังไม่ครบ</small>}
        </section>

        <section className="production-print-note" aria-label="หมายเหตุ">
          <strong>หมายเหตุ</strong>
          <p>{order.note || "—"}</p>
        </section>

        <footer className="production-print-signatures">
          <div>
            <span className="signature-line" />
            <strong>ผู้สั่งผลิต</strong>
            <small>วันที่ ______ / ______ / ______</small>
          </div>
          <div>
            <span className="signature-line" />
            <strong>ผู้รับออเดอร์</strong>
            <small>วันที่ ______ / ______ / ______</small>
          </div>
        </footer>
      </article>
    </div>
  );
}
