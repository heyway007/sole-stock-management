"use client";

import { Button } from "@/components/ui/button";
import { InventoryPrint } from "@/features/inventory/components/inventory-print";
import { inventoryRows } from "@/features/inventory/domain/selectors";
import { useInventory } from "@/features/inventory/inventory-provider";

function formatPrintedAt(date: Date): string {
  return date.toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric" });
}

export default function InventoryPrintPage() {
  const { snapshot, loading, error, refresh } = useInventory();
  if (loading && !snapshot) return <div className="page-state" role="status">กำลังโหลดข้อมูลสต็อกสำหรับพิมพ์…</div>;
  if (error && !snapshot) {
    return <div className="page-state page-state--error" role="alert"><p>{error}</p><Button variant="secondary" onClick={() => void refresh()}>ลองใหม่</Button></div>;
  }
  if (!snapshot) return <div className="page-state" role="status">ยังไม่มีข้อมูลสต็อก</div>;

  const rows = inventoryRows(snapshot);
  return <InventoryPrint rows={rows} printedAt={formatPrintedAt(new Date())} />;
}
