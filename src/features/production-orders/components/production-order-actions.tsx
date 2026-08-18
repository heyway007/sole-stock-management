"use client";

import Link from "next/link";
import { Ban, Edit3, PackageCheck, Printer } from "lucide-react";
import { useState } from "react";
import Swal from "sweetalert2";
import { Button } from "@/components/ui/button";
import type {
  ProductionOrder,
  ProductionOrderLine,
  ProductionOrderReceiptInput,
  ProductionOrderReceiptResult,
} from "../domain/types";

interface ProductionOrderActionsProps {
  order: ProductionOrder;
  onCancel(orderId: string): Promise<ProductionOrder>;
  onReceive(input: ProductionOrderReceiptInput): Promise<ProductionOrderReceiptResult>;
}

function localDateValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function ProductionOrderActions({ order, onCancel, onReceive }: ProductionOrderActionsProps) {
  const [pending, setPending] = useState<"cancel" | "receive" | null>(null);
  const totalPairs = order.lines.reduce(
    (sum, line) => sum + Math.max(0, line.quantity - line.receivedQuantity),
    0,
  );

  async function confirmCancellation() {
    const result = await Swal.fire({
      icon: "warning",
      title: "ยืนยันยกเลิกใบผลิต",
      text: `ใบผลิต ${order.number} จะยังคงอยู่ในประวัติและไม่สามารถรับเข้าสต๊อกได้`,
      showCancelButton: true,
      confirmButtonText: "ยืนยันยกเลิกใบผลิต",
      cancelButtonText: "กลับ",
      confirmButtonColor: "#b74435",
      focusCancel: true,
      showLoaderOnConfirm: true,
      allowOutsideClick: () => !Swal.isLoading(),
      allowEscapeKey: () => !Swal.isLoading(),
      preConfirm: async () => {
        setPending("cancel");
        try {
          return await onCancel(order.id);
        } catch (error) {
          Swal.showValidationMessage(error instanceof Error ? error.message : "ไม่สามารถยกเลิกใบผลิตได้ กรุณาลองใหม่อีกครั้ง");
          return false;
        } finally {
          setPending(null);
        }
      },
    });
    if (!result.isConfirmed) return;
    await Swal.fire({
      icon: "success",
      title: "ยกเลิกใบผลิตแล้ว",
      text: `ใบผลิต ${order.number} ถูกยกเลิกและยังคงอยู่ในประวัติ`,
      confirmButtonText: "ตกลง",
      confirmButtonColor: "#237b58",
    });
  }

  async function confirmReceipt() {
    const result = await Swal.fire({
      icon: "question",
      title: "ยืนยันรับเข้าสต๊อก",
      text: `รับ ${totalPairs} คู่ จากใบผลิต ${order.number} เข้าสต๊อกทั้งหมด`,
      showCancelButton: true,
      confirmButtonText: "ยืนยันรับเข้าสต๊อก",
      cancelButtonText: "กลับ",
      confirmButtonColor: "#237b58",
      focusCancel: true,
      showLoaderOnConfirm: true,
      allowOutsideClick: () => !Swal.isLoading(),
      allowEscapeKey: () => !Swal.isLoading(),
      preConfirm: async () => {
        setPending("receive");
        try {
          return await onReceive({ orderId: order.id, effectiveDate: localDateValue() });
        } catch (error) {
          Swal.showValidationMessage(error instanceof Error ? error.message : "ไม่สามารถรับเข้าสต๊อกได้ กรุณาลองใหม่อีกครั้ง");
          return false;
        } finally {
          setPending(null);
        }
      },
    });
    if (!result.isConfirmed) return;
    const receipt = result.value as ProductionOrderReceiptResult;
    await Swal.fire({
      icon: "success",
      title: "รับเข้าสต๊อกแล้ว",
      text: `เลขที่เอกสาร ${receipt.document.number}`,
      confirmButtonText: "ตกลง",
      confirmButtonColor: "#237b58",
    });
  }

  return (
    <div className="production-order-actions" aria-label="จัดการใบผลิต">
      <Link className="button button--secondary" href={`/production-orders/${order.id}/print`}>
        <Printer aria-hidden size={17} />พิมพ์ใบผลิต
      </Link>
      {order.status === "OPEN" && <>
        <Link className="button button--secondary" href={`/production-orders/${order.id}/edit`}>
          <Edit3 aria-hidden size={17} />แก้ไข
        </Link>
        <Button variant="secondary" className="production-cancel-action" disabled={pending !== null} onClick={() => void confirmCancellation()}>
          <Ban aria-hidden size={17} />ยกเลิกใบผลิต
        </Button>
        <Button disabled={pending !== null} onClick={() => void confirmReceipt()}>
          <PackageCheck aria-hidden size={17} />รับเข้าสต๊อก
        </Button>
      </>}
    </div>
  );
}

interface ProductionOrderLineReceiptActionProps {
  order: ProductionOrder;
  line: ProductionOrderLine;
  onReceive(input: ProductionOrderReceiptInput): Promise<ProductionOrderReceiptResult>;
}

export function ProductionOrderLineReceiptAction({
  order,
  line,
  onReceive,
}: ProductionOrderLineReceiptActionProps) {
  const [pending, setPending] = useState(false);
  const remaining = Math.max(0, line.quantity - line.receivedQuantity);

  async function confirmPartialReceipt() {
    const result = await Swal.fire({
      icon: "question",
      title: "รับเข้าแยก",
      text: `เหลือรับเข้า ${remaining} คู่ สำหรับ ${line.modelName} / ${line.colorName} / ไซซ์ ${line.size}`,
      input: "number",
      inputValue: remaining,
      inputAttributes: { min: "1", max: String(remaining), step: "1" },
      showCancelButton: true,
      confirmButtonText: "ยืนยันรับเข้า",
      cancelButtonText: "ยกเลิก",
      confirmButtonColor: "#237b58",
      focusCancel: true,
      showLoaderOnConfirm: true,
      allowOutsideClick: () => !Swal.isLoading(),
      allowEscapeKey: () => !Swal.isLoading(),
      preConfirm: async (rawValue) => {
        const quantity = Number(rawValue);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > remaining) {
          Swal.showValidationMessage(`กรอกจำนวนตั้งแต่ 1 ถึง ${remaining} คู่`);
          return false;
        }
        setPending(true);
        try {
          return await onReceive({
            orderId: order.id,
            effectiveDate: localDateValue(),
            lines: [{ lineId: line.id, quantity }],
          });
        } catch (error) {
          Swal.showValidationMessage(error instanceof Error ? error.message : "ไม่สามารถรับเข้าแยกได้ กรุณาลองใหม่อีกครั้ง");
          return false;
        } finally {
          setPending(false);
        }
      },
    });
    if (!result.isConfirmed) return;
    const receipt = result.value as ProductionOrderReceiptResult;
    await Swal.fire({
      icon: "success",
      title: "รับเข้าแยกแล้ว",
      text: `เลขที่เอกสาร ${receipt.document.number}`,
      confirmButtonText: "ตกลง",
      confirmButtonColor: "#237b58",
    });
  }

  if (order.status !== "OPEN" || remaining === 0) return null;
  return (
    <Button
      variant="secondary"
      className="production-line-receive-action"
      disabled={pending}
      onClick={() => void confirmPartialReceipt()}
    >
      <PackageCheck aria-hidden size={15} />รับเข้าแยก
    </Button>
  );
}
