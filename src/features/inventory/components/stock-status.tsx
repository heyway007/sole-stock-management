import type { InventoryRow } from "@/features/inventory/domain/selectors";
import { StatusBadge } from "@/components/ui/status-badge";

const statusCopy = {
  NORMAL: { label: "ปกติ", tone: "success" },
  LOW: { label: "สต๊อกต่ำ", tone: "warning" },
  OUT: { label: "สินค้าหมด", tone: "danger" },
} as const;

export function StockStatus({ status }: { status: InventoryRow["status"] }) {
  const presentation = statusCopy[status];
  return <StatusBadge tone={presentation.tone}>{presentation.label}</StatusBadge>;
}
