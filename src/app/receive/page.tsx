"use client";

import { useMemo, useState } from "react";
import { Toast } from "@/components/ui/toast";
import { DocumentForm, type DocumentMetadata } from "@/features/inventory/components/document-form";
import { createDocumentLine, DocumentLineEditor, type DocumentLineDraft, type DocumentVariantOption } from "@/features/inventory/components/document-line-editor";
import { DocumentValidationError, validateDocument } from "@/features/inventory/domain/validation";
import { useInventory } from "@/features/inventory/inventory-provider";

function isDraftDirty(line: DocumentLineDraft) {
  return !!(line.modelId || line.colorId || line.variantId || line.quantity);
}

export function ReceivePageContent() {
  const { snapshot, loading, error, postDocument, ensureVariant } = useInventory();
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
    const preparedLines = lines.map((line) => {
      const selected = variants.find((variant) => variant.id === line.variantId);
      const size = line.creatingVariant ? Number(line.newSize) : selected?.size ?? 0;
      const matching = variants.find((variant) =>
        variant.modelId === line.modelId && variant.colorId === line.colorId && variant.size === size,
      );
      return { draft: line, size, matching };
    });
    const input = {
      type: "RECEIPT" as const,
      ...metadata,
      lines: preparedLines.map(({ draft, size, matching }) => ({
        variantId: matching?.id ?? (draft.modelId && draft.colorId && size > 0
          ? `new:${draft.modelId}:${draft.colorId}:${size}`
          : ""),
        size,
        quantity: Number(draft.quantity),
      })),
    };
    const validation = validateDocument(input);
    if (!validation.success) throw new DocumentValidationError(validation.errors);
    const resolvedLines = await Promise.all(preparedLines.map(async ({ draft, size, matching }, index) => {
      const variant = matching ?? await ensureVariant(draft.modelId, draft.colorId, size);
      return { ...validation.data.lines[index], variantId: variant.id, size: variant.size };
    }));
    const document = await postDocument({ ...validation.data, lines: resolvedLines });
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
        <DocumentLineEditor
          section="DEFAULT"
          lines={lines}
          onChange={setLines}
          variants={variants}
          showAvailable={false}
          catalogModels={snapshot.models.filter((model) => model.active).map(({ id, name }) => ({ id, name }))}
          catalogColors={snapshot.colors.filter((color) => color.active).map(({ id, name }) => ({ id, name }))}
          allowVariantCreation
        />
      </DocumentForm>
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </>
  );
}

export default function ReceivePage() {
  return <ReceivePageContent />;
}
