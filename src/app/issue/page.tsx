"use client";

import { useMemo, useState } from "react";
import { Select } from "@/components/ui/select";
import { Toast } from "@/components/ui/toast";
import { DocumentForm, type DocumentMetadata } from "@/features/inventory/components/document-form";
import { createDocumentLine, DocumentLineEditor, type DocumentLineDraft, type DocumentVariantOption } from "@/features/inventory/components/document-line-editor";
import type { MovementType } from "@/features/inventory/domain/types";
import { validateDocument } from "@/features/inventory/domain/validation";
import { InventoryProvider, useInventory } from "@/features/inventory/inventory-provider";

type IssueReason = "" | "SALE" | "DAMAGE" | "ADJUSTMENT";
type AdjustmentDirection = "" | "IN" | "OUT";

function draftDirty(line: DocumentLineDraft) {
  return !!(line.modelId || line.colorId || line.variantId || line.quantity);
}

export function IssuePageContent() {
  const { snapshot, loading, error, postDocument } = useInventory();
  const [reason, setReason] = useState<IssueReason>("");
  const [adjustmentDirection, setAdjustmentDirection] = useState<AdjustmentDirection>("");
  const [lines, setLines] = useState<DocumentLineDraft[]>(() => [createDocumentLine()]);
  const [toast, setToast] = useState<string | null>(null);

  const variants = useMemo<DocumentVariantOption[]>(() => {
    if (!snapshot) return [];
    return snapshot.variants.filter((variant) => variant.active).flatMap((variant) => {
      const model = snapshot.models.find((candidate) => candidate.id === variant.modelId && candidate.active);
      const color = snapshot.colors.find((candidate) => candidate.id === variant.colorId && candidate.active);
      return model && color ? [{ ...variant, modelName: model.name, colorName: color.name, available: snapshot.balances[variant.id] ?? 0 }] : [];
    });
  }, [snapshot]);

  async function submit(metadata: DocumentMetadata) {
    if (!reason) throw new Error("กรุณาเลือกเหตุผลการนำออก");
    if (reason === "ADJUSTMENT" && !adjustmentDirection) throw new Error("กรุณาเลือกเพิ่มยอดหรือลดยอด");

    const outgoing = reason !== "ADJUSTMENT" || adjustmentDirection === "OUT";
    const input = {
      type: reason as MovementType,
      ...metadata,
      lines: lines.map((line) => ({
        variantId: line.variantId,
        size: variants.find((variant) => variant.id === line.variantId)?.size ?? 0,
        quantity: Number(line.quantity),
        ...(reason === "ADJUSTMENT" ? { direction: adjustmentDirection as "IN" | "OUT" } : {}),
      })),
    };
    const validation = validateDocument(input);
    if (!validation.success) throw new Error(validation.errors[0].message);
    if (outgoing && validation.data.lines.some((line) => {
      const variant = variants.find((candidate) => candidate.id === line.variantId);
      return line.quantity > (variant?.available ?? 0);
    })) {
      throw new Error("จำนวนที่นำออกเกินสต็อกคงเหลือ");
    }

    const document = await postDocument(validation.data);
    setReason("");
    setAdjustmentDirection("");
    setLines([createDocumentLine()]);
    setToast(`นำสินค้าออกเรียบร้อย เลขที่เอกสาร ${document.number}`);
  }

  if (loading) return <div className="page-state" role="status">กำลังโหลดข้อมูลสต็อก…</div>;
  if (!snapshot) return <div className="page-state page-state--error" role="alert">{error ?? "ยังไม่มีข้อมูลสต็อก"}</div>;

  const reasonControls = (
    <section className="document-card issue-reason" aria-label="เหตุผลและทิศทาง">
      <Select
        label="เหตุผลการนำออก"
        value={reason}
        onChange={(event) => {
          setReason(event.target.value as IssueReason);
          setAdjustmentDirection("");
        }}
      >
        <option value="">เลือกเหตุผล</option>
        <option value="SALE">ขาย</option>
        <option value="DAMAGE">ชำรุด</option>
        <option value="ADJUSTMENT">ปรับยอด</option>
      </Select>
      {reason === "ADJUSTMENT" && (
        <Select label="ทิศทางการปรับยอด" value={adjustmentDirection} onChange={(event) => setAdjustmentDirection(event.target.value as AdjustmentDirection)}>
          <option value="">เลือกทิศทาง</option>
          <option value="IN">เพิ่มยอด</option>
          <option value="OUT">ลดยอด</option>
        </Select>
      )}
    </section>
  );

  return (
    <>
      <DocumentForm
        title="นำสินค้าออก"
        eyebrow="สินค้าออก"
        description="บันทึกการขาย สินค้าชำรุด หรือปรับยอด พร้อมตรวจสอบสต็อกคงเหลือ"
        submitLabel="บันทึกการนำออก"
        dirty={!!reason || !!adjustmentDirection || lines.some(draftDirty)}
        beforeLines={reasonControls}
        onSubmit={submit}
      >
        <DocumentLineEditor section="DEFAULT" lines={lines} onChange={setLines} variants={variants} showAvailable />
      </DocumentForm>
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </>
  );
}

export default function IssuePage() {
  return <InventoryProvider><IssuePageContent /></InventoryProvider>;
}
