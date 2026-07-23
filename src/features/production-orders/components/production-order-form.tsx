"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import {
  createDocumentLine,
  DocumentLineEditor,
  type DocumentLineDraft,
  type DocumentVariantOption,
} from "@/features/inventory/components/document-line-editor";
import {
  DocumentValidationContext,
  type DocumentValidationContextValue,
} from "@/features/inventory/components/document-validation-context";
import { RepositoryStatusBanner } from "@/features/inventory/components/repository-status-banner";
import type { InventorySnapshot, ValidationError } from "@/features/inventory/domain/types";
import { useUnsavedChanges } from "@/features/inventory/hooks/use-unsaved-changes";
import { useInventory } from "@/features/inventory/inventory-provider";
import type {
  ProductionOrder,
  ProductionOrderInput,
  ProductionOrderValidationError,
} from "../domain/types";
import {
  ProductionOrderValidationException,
  validateProductionOrder,
} from "../domain/validation";
import { useProductionOrders } from "../production-order-provider";
import {
  formatBahtMinor,
  lineTotalMinor,
  parseUnitPriceInput,
} from "../domain/money";
import { ProductionOrderLinePrice } from "./production-order-line-price";

interface ProductionOrderFormProps {
  order?: ProductionOrder;
  onSaved(order: ProductionOrder): void;
}

function localDateValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function initialLines(order: ProductionOrder | undefined, snapshot: InventorySnapshot): DocumentLineDraft[] {
  if (!order) return [{ ...createDocumentLine(), unitPrice: "" }];
  return order.lines.map((line) => {
    const variant = snapshot.variants.find((candidate) => candidate.id === line.variantId);
    return {
      ...createDocumentLine(),
      modelId: variant?.modelId ?? "",
      colorId: variant?.colorId ?? "",
      variantId: line.variantId,
      quantity: String(line.quantity),
      unitPrice: line.unitPrice === null ? "" : String(line.unitPrice),
    };
  });
}

function validationCode(error: ProductionOrderValidationError): ValidationError["code"] {
  if (error.code === "INVALID_QUANTITY") return "INVALID_QUANTITY";
  if (error.code === "DUPLICATE_VARIANT") return "DUPLICATE_VARIANT";
  return "REQUIRED";
}

function ProductionOrderFormReady({
  order,
  onSaved,
  snapshot,
}: ProductionOrderFormProps & { snapshot: InventorySnapshot }) {
  const { save, warning } = useProductionOrders();
  const today = useMemo(() => localDateValue(), []);
  const initialOrderDate = order?.orderDate ?? today;
  const initialExpectedDate = order?.expectedDate ?? today;
  const initialNote = order?.note ?? "";
  const initialDrafts = useMemo(() => initialLines(order, snapshot), [order, snapshot]);
  const [orderDate, setOrderDate] = useState(initialOrderDate);
  const [expectedDate, setExpectedDate] = useState(initialExpectedDate);
  const [note, setNote] = useState(initialNote);
  const [lines, setLines] = useState<DocumentLineDraft[]>(initialDrafts);
  const [validationErrors, setValidationErrors] = useState<ProductionOrderValidationError[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);

  const variants = useMemo<DocumentVariantOption[]>(() => snapshot.variants.flatMap((variant) => {
    if (!variant.active) return [];
    const model = snapshot.models.find((candidate) => candidate.id === variant.modelId && candidate.active);
    const color = snapshot.colors.find((candidate) => candidate.id === variant.colorId && candidate.active);
    return model && color ? [{
      ...variant,
      modelName: model.name,
      colorName: color.name,
      available: 0,
    }] : [];
  }), [snapshot]);

  const input = useMemo<ProductionOrderInput>(() => ({
    ...(order ? { id: order.id } : {}),
    orderDate,
    expectedDate,
    note,
    lines: lines.map((line) => ({
      variantId: line.variantId,
      quantity: Number(line.quantity),
      unitPrice: parseUnitPriceInput(line.unitPrice ?? "") ?? Number.NaN,
    })),
  }), [expectedDate, lines, note, order, orderDate]);
  const initialFingerprint = useMemo(() => JSON.stringify({
    ...(order ? { id: order.id } : {}),
    orderDate: initialOrderDate,
    expectedDate: initialExpectedDate,
    note: initialNote,
    lines: initialDrafts.map((line) => ({
      variantId: line.variantId,
      quantity: Number(line.quantity),
      unitPrice: parseUnitPriceInput(line.unitPrice ?? "") ?? Number.NaN,
    })),
  }), [initialDrafts, initialExpectedDate, initialNote, initialOrderDate, order]);
  const dirty = JSON.stringify(input) !== initialFingerprint;
  useUnsavedChanges(!saved && dirty);

  const activeLines = lines.filter((line) =>
    line.variantId || line.quantity.trim() || line.unitPrice?.trim());
  const lineCount = activeLines.length;
  const totalPairs = lines.reduce((total, line) => {
    const quantity = Number(line.quantity);
    return total + (Number.isFinite(quantity) && quantity > 0 ? quantity : 0);
  }, 0);
  const lineTotals = activeLines.map((line) => {
    const price = parseUnitPriceInput(line.unitPrice ?? "");
    return price === null ? null : lineTotalMinor(Number(line.quantity), price);
  });
  const totalAmountMinor = lineCount > 0 && lineTotals.every((total) => total !== null)
    ? lineTotals.reduce<number>((total, value) => total + (value ?? 0), 0)
    : null;
  const contextErrors = useMemo<ValidationError[]>(() => validationErrors
    .filter((error) => error.path.startsWith("lines."))
    .map((error) => ({ ...error, code: validationCode(error) })), [validationErrors]);
  const validationContext = useMemo<DocumentValidationContextValue>(() => ({
    errors: contextErrors,
    errorFor: (path) => validationErrors.find((error) => error.path === path)?.message ?? null,
    clearErrors: (paths) => setValidationErrors((current) =>
      current.filter((error) => !paths.includes(error.path))),
    clearAllErrors: () => setValidationErrors([]),
  }), [contextErrors, validationErrors]);

  function clearHeaderError(path: string) {
    setValidationErrors((current) => current.filter((error) => error.path !== path));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);
    setValidationErrors([]);
    const validated = validateProductionOrder(input);
    if (!validated.success) {
      setValidationErrors(validated.errors);
      setFormError("กรุณาตรวจสอบข้อมูลในแบบฟอร์ม");
      return;
    }

    setSubmitting(true);
    try {
      const savedOrder = await save(validated.data);
      setSaved(true);
      onSaved(savedOrder);
    } catch (error) {
      if (error instanceof ProductionOrderValidationException) {
        setValidationErrors(error.errors);
      }
      setFormError(error instanceof Error ? error.message : "ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page-container workflow-page production-order-form-page">
      <header className="page-header production-form-header">
        <div>
          <p className="eyebrow">{order ? order.number : "ใบผลิตใหม่"}</p>
          <h1>{order ? "แก้ไขใบผลิตออเดอร์" : "สร้างใบผลิตออเดอร์"}</h1>
          <p>{order ? "แก้ไขข้อมูลได้จนกว่าจะรับเข้าสต๊อกหรือยกเลิก" : "ระบบจะสร้างเลขที่ใบผลิตให้อัตโนมัติหลังบันทึก"}</p>
        </div>
        <Link className="button button--secondary" href={order ? `/production-orders/${order.id}` : "/production-orders"}>ยกเลิก</Link>
      </header>
      <RepositoryStatusBanner />
      {warning && <div className="repository-status-banner" role="alert">{warning}</div>}

      <DocumentValidationContext.Provider value={validationContext}>
        <form className="document-form production-order-form" onSubmit={(event) => void submit(event)}>
          <section className="document-card production-order-metadata" aria-label="ข้อมูลใบผลิต">
            <Field
              id="production-order-date"
              label="วันที่สั่งผลิต"
              type="date"
              required
              value={orderDate}
              error={validationContext.errorFor("orderDate")}
              onChange={(event) => { setOrderDate(event.target.value); clearHeaderError("orderDate"); }}
            />
            <Field
              id="production-expected-date"
              label="วันที่กำหนดรับ"
              type="date"
              required
              value={expectedDate}
              error={validationContext.errorFor("expectedDate")}
              onChange={(event) => { setExpectedDate(event.target.value); clearHeaderError("expectedDate"); }}
            />
            <label className="form-field document-note">
              <span className="form-field__label">หมายเหตุ</span>
              <span className="form-field__control"><textarea value={note} onChange={(event) => setNote(event.target.value)} /></span>
            </label>
          </section>

          <DocumentLineEditor
            title="รายการสั่งผลิต"
            section="DEFAULT"
            lines={lines}
            onChange={setLines}
            variants={variants}
            showAvailable={false}
            allowVariantCreation={false}
            extraLineFields={(context) => <ProductionOrderLinePrice {...context} />}
          />

          <div className="production-order-form-summary" role="status">
            รวม {lineCount} รายการ · {totalPairs} คู่ · {formatBahtMinor(totalAmountMinor)}
          </div>
          {formError && <div className="form-error-banner" role="alert">{formError}</div>}
          <footer className="document-actions">
            <Button type="submit" disabled={submitting}>
              {submitting ? "กำลังบันทึก…" : "บันทึกใบผลิต"}
            </Button>
          </footer>
        </form>
      </DocumentValidationContext.Provider>
    </div>
  );
}

export function ProductionOrderForm({ order, onSaved }: ProductionOrderFormProps) {
  const { snapshot, loading, error } = useInventory();
  if (order && order.status !== "OPEN") {
    return (
      <div className="page-state production-terminal-state">
        <div>
          <h1>ไม่สามารถแก้ไขใบผลิตนี้ได้</h1>
          <p>แก้ไขได้เฉพาะใบผลิตที่อยู่ในสถานะรอรับเข้า</p>
          <Link className="button button--primary" href={`/production-orders/${order.id}`}>กลับไปดูรายละเอียด</Link>
        </div>
      </div>
    );
  }
  if (loading && !snapshot) return <div className="page-state" role="status">กำลังโหลดข้อมูลสินค้า…</div>;
  if (error && !snapshot) return <div className="page-state page-state--error" role="alert">{error}</div>;
  if (!snapshot) return null;
  return <ProductionOrderFormReady order={order} onSaved={onSaved} snapshot={snapshot} />;
}
