import { StatusBadge } from "@/components/ui/status-badge";
import type { ProductionOrderStatus as ProductionOrderStatusValue } from "../domain/types";

const labels = {
  OPEN: "รอรับเข้า",
  RECEIVED: "รับเข้าแล้ว",
  CANCELLED: "ยกเลิก",
} as const;

const tones = {
  OPEN: "warning",
  RECEIVED: "success",
  CANCELLED: "neutral",
} as const;

export function ProductionOrderStatus({ status }: { status: ProductionOrderStatusValue }) {
  return <StatusBadge tone={tones[status]}>{labels[status]}</StatusBadge>;
}
