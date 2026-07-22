"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import type { ProductVariant } from "@/features/inventory/domain/types";
import { useDocumentValidation } from "./document-validation-context";

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
  creatingVariant: boolean;
  newSize: string;
  quantity: string;
}

let nextLineId = 0;

export function createDocumentLine(): DocumentLineDraft {
  nextLineId += 1;
  return {
    id: `document-line-${nextLineId}`,
    modelId: "",
    colorId: "",
    variantId: "",
    creatingVariant: false,
    newSize: "",
    quantity: "",
  };
}

interface DocumentLineEditorProps {
  section: "DEFAULT" | "RETURNED" | "REPLACEMENT";
  lines: DocumentLineDraft[];
  onChange(lines: DocumentLineDraft[]): void;
  variants: DocumentVariantOption[];
  showAvailable: boolean;
  title?: string;
  catalogModels?: Array<{ id: string; name: string }>;
  catalogColors?: Array<{ id: string; name: string }>;
  allowVariantCreation?: boolean;
  lineIndexOffset?: number;
}

function uniqueById(items: Array<{ id: string; name: string }>) {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

export function DocumentLineEditor({
  section,
  lines,
  onChange,
  variants,
  showAvailable,
  title,
  catalogModels,
  catalogColors,
  allowVariantCreation = false,
  lineIndexOffset = 0,
}: DocumentLineEditorProps) {
  const { errorFor, clearErrors, clearAllErrors } = useDocumentValidation();
  const models = catalogModels ?? uniqueById(variants.map((variant) => ({ id: variant.modelId, name: variant.modelName })));
  const selectedVariantIds = new Set(lines.map((line) => line.variantId).filter(Boolean));

  function updateLine(id: string, update: Partial<DocumentLineDraft>, fields: string[]) {
    const index = lines.findIndex((line) => line.id === id);
    if (index >= 0) {
      clearErrors([
        ...fields.map((field) => `lines.${lineIndexOffset + index}.${field}`),
        "lines",
      ]);
    }
    onChange(lines.map((line) => line.id === id ? { ...line, ...update } : line));
  }

  return (
    <section className="line-editor" aria-label={title ?? "รายการสินค้า"} data-section={section}>
      {title && <h2>{title}</h2>}
      <div className="line-editor__rows">
        {lines.map((line, index) => {
          const rowNumber = index + 1;
          const validationIndex = lineIndexOffset + index;
          const controlId = `${section.toLowerCase()}-${line.id}`;
          const variantError = errorFor(`lines.${validationIndex}.variantId`)
            ?? errorFor(`lines.${validationIndex}.section`);
          const sizeError = errorFor(`lines.${validationIndex}.size`);
          const quantityError = errorFor(`lines.${validationIndex}.quantity`);
          const modelError = !line.modelId ? variantError : null;
          const colorError = line.modelId && !line.colorId ? variantError : null;
          const selectedSizeError = !line.creatingVariant && line.modelId && line.colorId
            ? sizeError ?? variantError
            : sizeError;
          const colors = catalogColors ?? uniqueById(variants
            .filter((variant) => variant.modelId === line.modelId)
            .map((variant) => ({ id: variant.colorId, name: variant.colorName })));
          const sizes = variants.filter((variant) => variant.modelId === line.modelId && variant.colorId === line.colorId);
          const selected = variants.find((variant) => variant.id === line.variantId);
          return (
            <fieldset className="document-line" key={line.id}>
              <legend>รายการ {rowNumber}</legend>
              <Select
                id={`${controlId}-model`}
                label={`รุ่นสินค้า รายการ ${rowNumber}`}
                value={line.modelId}
                error={modelError}
                announceError={false}
                onChange={(event) => updateLine(line.id, {
                  modelId: event.target.value,
                  colorId: "",
                  variantId: "",
                  creatingVariant: false,
                  newSize: "",
                }, ["variantId", "size", "section"])}
              >
                <option value="">เลือกรุ่น</option>
                {models.map((model) => <option value={model.id} key={model.id}>{model.name}</option>)}
              </Select>
              <Select
                id={`${controlId}-color`}
                label={`สีสินค้า รายการ ${rowNumber}`}
                value={line.colorId}
                disabled={!line.modelId}
                error={colorError}
                announceError={false}
                onChange={(event) => updateLine(line.id, {
                  colorId: event.target.value,
                  variantId: "",
                  creatingVariant: false,
                  newSize: "",
                }, ["variantId", "size", "section"])}
              >
                <option value="">เลือกสี</option>
                {colors.map((color) => <option value={color.id} key={color.id}>{color.name}</option>)}
              </Select>
              <Select
                id={`${controlId}-size`}
                label={`ไซซ์ รายการ ${rowNumber}`}
                value={line.creatingVariant ? "__new__" : selected?.size.toString() ?? ""}
                disabled={!line.colorId}
                error={line.creatingVariant ? null : selectedSizeError}
                announceError={false}
                onChange={(event) => {
                  if (event.target.value === "__new__") {
                    updateLine(line.id, { variantId: "", creatingVariant: true, newSize: "" }, ["variantId", "size", "section"]);
                    return;
                  }
                  const variant = sizes.find((candidate) => candidate.size.toString() === event.target.value);
                  updateLine(line.id, { variantId: variant?.id ?? "", creatingVariant: false, newSize: "" }, ["variantId", "size", "section"]);
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
                {allowVariantCreation && line.modelId && line.colorId && <option value="__new__">เพิ่มไซซ์ใหม่</option>}
              </Select>
              {allowVariantCreation && line.creatingVariant && (
                <Field
                  id={`${controlId}-new-size`}
                  label={`ไซซ์ใหม่ รายการ ${rowNumber}`}
                  type="number"
                  step="0.1"
                  inputMode="decimal"
                  value={line.newSize}
                  error={sizeError ?? variantError}
                  announceError={false}
                  onChange={(event) => updateLine(line.id, { newSize: event.target.value }, ["variantId", "size", "section"])}
                />
              )}
              <Field
                id={`${controlId}-quantity`}
                label={`จำนวน (คู่) รายการ ${rowNumber}`}
                type="number"
                step="any"
                inputMode="numeric"
                value={line.quantity}
                error={quantityError}
                announceError={false}
                onChange={(event) => updateLine(line.id, { quantity: event.target.value }, ["quantity"])}
              />
              {showAvailable && selected && <p className="available-quantity" role="status">คงเหลือ {selected.available} คู่</p>}
              {lines.length > 1 && (
                <Button variant="ghost" className="remove-line" aria-label={`ลบรายการ ${rowNumber}`} onClick={() => { clearAllErrors(); onChange(lines.filter((candidate) => candidate.id !== line.id)); }}>
                  <Trash2 aria-hidden size={17} />ลบ
                </Button>
              )}
            </fieldset>
          );
        })}
      </div>
      <Button variant="secondary" className="add-line" onClick={() => { clearAllErrors(); onChange([...lines, createDocumentLine()]); }}>
        <Plus aria-hidden size={17} />เพิ่มรายการ
      </Button>
    </section>
  );
}
