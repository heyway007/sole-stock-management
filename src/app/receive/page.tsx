"use client";

import { useMemo, useState } from "react";
import { Toast } from "@/components/ui/toast";
import { DocumentForm, type DocumentMetadata } from "@/features/inventory/components/document-form";
import { createDocumentLine, DocumentLineEditor, type DocumentLineDraft, type DocumentVariantOption } from "@/features/inventory/components/document-line-editor";
import { validateDocument } from "@/features/inventory/domain/validation";
import { InventoryProvider, useInventory } from "@/features/inventory/inventory-provider";

function isDraftDirty(line: DocumentLineDraft) {
  return !!(line.modelId || line.colorId || line.variantId || line.quantity);
}

export function ReceivePageContent() {
  const { snapshot, loading, error, postDocument } = useInventory();
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
    const input = {
      type: "RECEIPT" as const,
      ...metadata,
      lines: lines.map((line) => ({
        variantId: line.variantId,
        size: variants.find((variant) => variant.id === line.variantId)?.size ?? 0,
        quantity: Number(line.quantity),
      })),
    };
    const validation = validateDocument(input);
    if (!validation.success) throw new Error(validation.errors[0].message);
    const document = await postDocument(validation.data);
    setLines([createDocumentLine()]);
    setToast(`รับสินค้าเรียบร้อย เลขที่เอกสาร ${document.number}`);
  }

  if (loading) return <div className="page-state" role="status">กำลังโหลดข้อมูลสต็อก…</div>;
  if (!snapshot) return <div className="page-state page-state--error" role="alert">{error ?? "ยังไม่มีข้อมูลสต็อก"}</div>;

  return (
    <>
      <DocumentForm
        title="รับสินค้า"
        eyebrow="สินค้าเข้า"
        description="บันทึกสินค้าที่รับเข้าได้หลายรุ่น สี และไซซ์ในเอกสารเดียว"
        submitLabel="บันทึกรับสินค้า"
        dirty={lines.some(isDraftDirty)}
        onSubmit={submit}
      >
        <DocumentLineEditor section="DEFAULT" lines={lines} onChange={setLines} variants={variants} showAvailable={false} />
      </DocumentForm>
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </>
  );
}

export default function ReceivePage() {
  return <InventoryProvider><ReceivePageContent /></InventoryProvider>;
}
