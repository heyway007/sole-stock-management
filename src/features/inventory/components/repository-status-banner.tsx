"use client";

import { TriangleAlert } from "lucide-react";
import { useInventory } from "@/features/inventory/inventory-provider";

export function RepositoryStatusBanner() {
  const { snapshot, warning } = useInventory();
  if (!snapshot || !warning) return null;

  return (
    <div className="repository-status-banner" role="alert">
      <TriangleAlert aria-hidden size={19} />
      <span><strong>ข้อมูลอาจยังไม่เป็นปัจจุบัน</strong>{warning}</span>
    </div>
  );
}
