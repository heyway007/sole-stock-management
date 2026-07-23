"use client";

import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { PRODUCTION_COMPANY_PROFILE as profile } from "@/features/production-orders/company-profile";
import type { InventoryRow } from "../domain/selectors";

const statusLabels = {
  NORMAL: "ปกติ",
  LOW: "สต๊อกต่ำ",
  OUT: "สินค้าหมด",
} as const;

export function InventoryPrint({ rows, printedAt }: { rows: InventoryRow[]; printedAt: string }) {
  const summary = useMemo(() => rows.reduce(
    (totals, row) => ({
      totalPairs: totals.totalPairs + row.quantity,
      lowCount: totals.lowCount + (row.status === "LOW" ? 1 : 0),
      outCount: totals.outCount + (row.status === "OUT" ? 1 : 0),
    }),
    { totalPairs: 0, lowCount: 0, outCount: 0 },
  ), [rows]);

  return (
    <div className="production-print-preview">
      <div className="print-controls print-hidden">
        <Link className="button button--secondary" href="/inventory">
          <ArrowLeft aria-hidden size={17} />กลับไปสินค้าคงคลัง
        </Link>
        <Button onClick={() => window.print()}>
          <Printer aria-hidden size={17} />พิมพ์รายงาน
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
            <h1>รายงานสินค้าคงคลัง</h1>
            <dl>
              <div><dt>วันที่พิมพ์</dt><dd>{printedAt}</dd></div>
              <div><dt>จำนวนรายการ</dt><dd>{rows.length} รายการ</dd></div>
            </dl>
          </section>
        </header>

        <table className="inventory-print-table" aria-label="รายการสินค้าคงคลัง">
          <thead>
            <tr>
              <th>#</th>
              <th>รุ่น</th>
              <th>สี</th>
              <th>ไซซ์</th>
              <th>คงเหลือ</th>
              <th>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.variantId}>
                <td>{index + 1}</td>
                <td>{row.modelName}</td>
                <td>{row.colorName}</td>
                <td>{row.size}</td>
                <td className="numeric">{row.quantity} คู่</td>
                <td>{statusLabels[row.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="production-print-summary" aria-label="สรุปยอดสินค้าคงคลัง">
          <strong>รวมทั้งหมด {rows.length} รายการ</strong>
          <strong>คงเหลือรวม {summary.totalPairs} คู่</strong>
          {(summary.lowCount > 0 || summary.outCount > 0) && (
            <small>สต๊อกต่ำ {summary.lowCount} รายการ · สินค้าหมด {summary.outCount} รายการ</small>
          )}
        </section>
      </article>
    </div>
  );
}
