"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Toast } from "@/components/ui/toast";
import { DocumentForm, type DocumentMetadata } from "@/features/inventory/components/document-form";
import { createDocumentLine, DocumentLineEditor, type DocumentLineDraft, type DocumentVariantOption } from "@/features/inventory/components/document-line-editor";
import { ExchangePreview } from "@/features/inventory/components/exchange-preview";
import type { StockDocumentInput, ValidationError } from "@/features/inventory/domain/types";
import { DocumentValidationError, validateDocument } from "@/features/inventory/domain/validation";
import { useInventory } from "@/features/inventory/inventory-provider";

function dirty(line: DocumentLineDraft) {
  return !!(line.modelId || line.colorId || line.variantId || line.quantity);
}

function negativeProjectionVariantIds(command: StockDocumentInput, variants: DocumentVariantOption[]): Set<string> {
  const projected = new Map(variants.map((variant) => [variant.id, variant.available]));
  for (const line of command.lines) {
    const delta = line.section === "RETURNED" ? line.quantity : -line.quantity;
    projected.set(line.variantId, (projected.get(line.variantId) ?? 0) + delta);
  }
  return new Set([...projected.entries()].filter(([, quantity]) => quantity < 0).map(([variantId]) => variantId));
}

export function ExchangePageContent() {
  const { snapshot, loading, error, postDocument } = useInventory();
  const [returnedLines, setReturnedLines] = useState<DocumentLineDraft[]>(() => [createDocumentLine()]);
  const [replacementLines, setReplacementLines] = useState<DocumentLineDraft[]>(() => [createDocumentLine()]);
  const [pending, setPending] = useState<StockDocumentInput | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  const variants = useMemo<DocumentVariantOption[]>(() => {
    if (!snapshot) return [];
    return snapshot.variants.filter((variant) => variant.active).flatMap((variant) => {
      const model = snapshot.models.find((candidate) => candidate.id === variant.modelId && candidate.active);
      const color = snapshot.colors.find((candidate) => candidate.id === variant.colorId && candidate.active);
      return model && color ? [{ ...variant, modelName: model.name, colorName: color.name, available: snapshot.balances[variant.id] ?? 0 }] : [];
    });
  }, [snapshot]);

  function commandLine(line: DocumentLineDraft, section: "RETURNED" | "REPLACEMENT") {
    return {
      variantId: line.variantId,
      size: variants.find((variant) => variant.id === line.variantId)?.size ?? 0,
      quantity: Number(line.quantity),
      section,
    };
  }

  async function prepare(metadata: DocumentMetadata): Promise<false> {
    const hasReturned = returnedLines.some((line) => line.variantId || line.quantity);
    const hasReplacement = replacementLines.some((line) => line.variantId || line.quantity);
    if (!hasReturned || !hasReplacement) {
      const errors: ValidationError[] = [];
      if (!hasReturned) {
        errors.push({ path: "lines.0.variantId", code: "INVALID_EXCHANGE", message: "รายการแลกเปลี่ยนต้องมีทั้งรายการคืนและรายการทดแทน" });
      }
      if (!hasReplacement) {
        errors.push({ path: `lines.${returnedLines.length}.variantId`, code: "INVALID_EXCHANGE", message: "รายการแลกเปลี่ยนต้องมีทั้งรายการคืนและรายการทดแทน" });
      }
      throw new DocumentValidationError(errors);
    }
    const command: StockDocumentInput = {
      type: "EXCHANGE",
      ...metadata,
      lines: [
        ...returnedLines.map((line) => commandLine(line, "RETURNED")),
        ...replacementLines.map((line) => commandLine(line, "REPLACEMENT")),
      ],
    };
    const validation = validateDocument(command);
    if (!validation.success) throw new DocumentValidationError(validation.errors);
    const negativeVariants = negativeProjectionVariantIds(validation.data, variants);
    const stockErrors = validation.data.lines.flatMap((line, index): ValidationError[] =>
      line.section === "REPLACEMENT" && negativeVariants.has(line.variantId)
        ? [{ path: `lines.${index}.quantity`, code: "INVALID_QUANTITY", message: "สินค้าทดแทนมีจำนวนไม่เพียงพอ" }]
        : [],
    );
    if (stockErrors.length > 0) {
      throw new DocumentValidationError(stockErrors);
    }
    setConfirmationError(null);
    setPending(validation.data);
    return false;
  }

  async function confirmExchange() {
    if (!pending || confirming) return;
    setConfirming(true);
    setConfirmationError(null);
    try {
      const document = await postDocument(pending);
      setPending(null);
      setReturnedLines([createDocumentLine()]);
      setReplacementLines([createDocumentLine()]);
      setResetKey((value) => value + 1);
      setToast(`เปลี่ยนสินค้าเรียบร้อย เลขที่เอกสาร ${document.number}`);
    } catch (caught) {
      setConfirmationError(caught instanceof Error ? caught.message : "ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setConfirming(false);
    }
  }

  if (loading) return <div className="page-state" role="status">กำลังโหลดข้อมูลสต็อก…</div>;
  if (!snapshot) return <div className="page-state page-state--error" role="alert">{error ?? "ยังไม่มีข้อมูลสต็อก"}</div>;

  return (
    <>
      <DocumentForm
        key={resetKey}
        title="เปลี่ยนสินค้า"
        eyebrow="แลกเปลี่ยน"
        description="รับสินค้าคืนและส่งสินค้าทดแทนในรายการเดียวกัน"
        submitLabel="ตรวจสอบการเปลี่ยน"
        dirty={returnedLines.some(dirty) || replacementLines.some(dirty)}
        onSubmit={prepare}
      >
        <div className="exchange-columns">
          <DocumentLineEditor title="สินค้าที่รับคืน" section="RETURNED" lines={returnedLines} onChange={setReturnedLines} variants={variants} showAvailable={false} />
          <DocumentLineEditor title="สินค้าที่ส่งทดแทน" section="REPLACEMENT" lines={replacementLines} onChange={setReplacementLines} variants={variants} showAvailable lineIndexOffset={returnedLines.length} />
        </div>
      </DocumentForm>

      <Modal open={!!pending} title="ยืนยันการเปลี่ยนสินค้า" description="ตรวจสอบจำนวนที่จะเพิ่มและลดก่อนบันทึก" onClose={() => { if (!confirming) setPending(null); }}>
        <div className="modal__body">
          {pending && <ExchangePreview command={pending} variants={variants} />}
          {confirmationError && <div className="form-error-banner" role="alert">{confirmationError}</div>}
        </div>
        <footer className="modal__footer">
          <Button variant="secondary" onClick={() => setPending(null)} disabled={confirming}>กลับไปแก้ไข</Button>
          <Button onClick={() => void confirmExchange()} disabled={confirming}>{confirming ? "กำลังบันทึก…" : "ยืนยันและบันทึก"}</Button>
        </footer>
      </Modal>
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </>
  );
}

export default function ExchangePage() {
  return <ExchangePageContent />;
}
