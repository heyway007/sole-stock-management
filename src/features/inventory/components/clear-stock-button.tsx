"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import Swal from "sweetalert2";
import { Button } from "@/components/ui/button";
import type { StockDocument } from "@/features/inventory/domain/types";

const confirmationPhrase = "ล้างสต๊อก";
const fallbackError = "ไม่สามารถล้างสต๊อกได้ กรุณาลองใหม่อีกครั้ง";

interface ClearStockButtonProps {
  positiveVariants: number;
  totalPairs: number;
  onClear(effectiveDate: string): Promise<StockDocument | null>;
}

function localDateValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function ClearStockButton({ positiveVariants, totalPairs, onClear }: ClearStockButtonProps) {
  const [clearing, setClearing] = useState(false);

  async function confirmClear() {
    const result = await Swal.fire({
      icon: "warning",
      title: "ยืนยันล้างสต๊อก",
      text: `สินค้าที่มียอด ${positiveVariants} รายการ รวม ${totalPairs} คู่ จะถูกปรับเป็น 0`,
      input: "text",
      inputLabel: `พิมพ์ ${confirmationPhrase} เพื่อยืนยัน`,
      inputAttributes: { autocomplete: "off", "aria-label": "พิมพ์คำยืนยันล้างสต๊อก" },
      showCancelButton: true,
      confirmButtonText: "ยืนยันล้างสต๊อก",
      cancelButtonText: "ยกเลิก",
      confirmButtonColor: "#b74435",
      focusCancel: true,
      showLoaderOnConfirm: true,
      allowOutsideClick: () => !Swal.isLoading(),
      allowEscapeKey: () => !Swal.isLoading(),
      preConfirm: async (value) => {
        if (value !== confirmationPhrase) {
          Swal.showValidationMessage(`กรุณาพิมพ์ ${confirmationPhrase} ให้ตรงกัน`);
          return false;
        }
        setClearing(true);
        try {
          return await onClear(localDateValue());
        } catch (error) {
          Swal.showValidationMessage(error instanceof Error ? error.message : fallbackError);
          return false;
        } finally {
          setClearing(false);
        }
      },
    });

    if (!result.isConfirmed) return;
    const document = result.value as StockDocument | null;
    const clearedPairs = document?.lines.reduce((total, line) => total + Math.abs(line.delta), 0) ?? 0;
    await Swal.fire({
      icon: "success",
      title: "ล้างสต๊อกแล้ว",
      text: clearedPairs > 0 ? `ล้างสต๊อกเรียบร้อย ${clearedPairs} คู่` : "สต๊อกเป็น 0 อยู่แล้ว",
      confirmButtonText: "ตกลง",
      confirmButtonColor: "#237b58",
    });
  }

  return (
    <Button
      className="clear-stock-button"
      variant="secondary"
      disabled={clearing || totalPairs === 0}
      aria-busy={clearing}
      onClick={() => void confirmClear()}
    >
      <Trash2 aria-hidden size={17} />
      ล้างสต๊อก
    </Button>
  );
}
