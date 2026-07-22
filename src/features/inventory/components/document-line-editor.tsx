"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import type { ProductVariant } from "@/features/inventory/domain/types";

export interface DocumentVariantOption extends ProductVariant {
  modelName: string;
  colorName: string;
  available: number;
}

export interface DocumentLineDraft {
  id: string;
  modelId: string;
  colorId: string;
  variantId: string;
  quantity: string;
}

let nextLineId = 0;

export function createDocumentLine(): DocumentLineDraft {
  nextLineId += 1;
  return { id: `document-line-${nextLineId}`, modelId: "", colorId: "", variantId: "", quantity: "" };
}

interface DocumentLineEditorProps {
  section: "DEFAULT" | "RETURNED" | "REPLACEMENT";
  lines: DocumentLineDraft[];
  onChange(lines: DocumentLineDraft[]): void;
  variants: DocumentVariantOption[];
  showAvailable: boolean;
  title?: string;
}

function uniqueById(items: Array<{ id: string; name: string }>) {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

export function DocumentLineEditor({ section, lines, onChange, variants, showAvailable, title }: DocumentLineEditorProps) {
  const models = uniqueById(variants.map((variant) => ({ id: variant.modelId, name: variant.modelName })));
  const selectedVariantIds = new Set(lines.map((line) => line.variantId).filter(Boolean));

  function updateLine(id: string, update: Partial<DocumentLineDraft>) {
    onChange(lines.map((line) => line.id === id ? { ...line, ...update } : line));
  }

  return (
    <section className="line-editor" aria-label={title ?? "รายการสินค้า"} data-section={section}>
      {title && <h2>{title}</h2>}
      <div className="line-editor__rows">
        {lines.map((line, index) => {
          const rowNumber = index + 1;
          const colors = uniqueById(variants
            .filter((variant) => variant.modelId === line.modelId)
            .map((variant) => ({ id: variant.colorId, name: variant.colorName })));
          const sizes = variants.filter((variant) => variant.modelId === line.modelId && variant.colorId === line.colorId);
          const selected = variants.find((variant) => variant.id === line.variantId);
          return (
            <fieldset className="document-line" key={line.id}>
              <legend>รายการ {rowNumber}</legend>
              <Select
                label={`รุ่นสินค้า รายการ ${rowNumber}`}
                value={line.modelId}
                onChange={(event) => updateLine(line.id, { modelId: event.target.value, colorId: "", variantId: "" })}
              >
                <option value="">เลือกรุ่น</option>
                {models.map((model) => <option value={model.id} key={model.id}>{model.name}</option>)}
              </Select>
              <Select
                label={`สีสินค้า รายการ ${rowNumber}`}
                value={line.colorId}
                disabled={!line.modelId}
                onChange={(event) => updateLine(line.id, { colorId: event.target.value, variantId: "" })}
              >
                <option value="">เลือกสี</option>
                {colors.map((color) => <option value={color.id} key={color.id}>{color.name}</option>)}
              </Select>
              <Select
                label={`ไซซ์ รายการ ${rowNumber}`}
                value={selected?.size.toString() ?? ""}
                disabled={!line.colorId}
                onChange={(event) => {
                  const variant = sizes.find((candidate) => candidate.size.toString() === event.target.value);
                  updateLine(line.id, { variantId: variant?.id ?? "" });
                }}
              >
                <option value="">เลือกไซซ์</option>
                {sizes.map((variant) => (
                  <option
                    value={variant.size.toString()}
                    key={variant.id}
                    disabled={variant.id !== line.variantId && selectedVariantIds.has(variant.id)}
                  >
                    {variant.size}
                  </option>
                ))}
              </Select>
              <Field
                label={`จำนวน (คู่) รายการ ${rowNumber}`}
                type="number"
                step="any"
                inputMode="numeric"
                value={line.quantity}
                onChange={(event) => updateLine(line.id, { quantity: event.target.value })}
              />
              {showAvailable && selected && <p className="available-quantity" role="status">คงเหลือ {selected.available} คู่</p>}
              {lines.length > 1 && (
                <Button variant="ghost" className="remove-line" aria-label={`ลบรายการ ${rowNumber}`} onClick={() => onChange(lines.filter((candidate) => candidate.id !== line.id))}>
                  <Trash2 aria-hidden size={17} />ลบ
                </Button>
              )}
            </fieldset>
          );
        })}
      </div>
      <Button variant="secondary" className="add-line" onClick={() => onChange([...lines, createDocumentLine()])}>
        <Plus aria-hidden size={17} />เพิ่มรายการ
      </Button>
    </section>
  );
}
