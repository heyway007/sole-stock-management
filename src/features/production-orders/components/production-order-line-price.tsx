"use client";

import { Field } from "@/components/ui/field";
import type { DocumentLineExtraFieldsContext } from "@/features/inventory/components/document-line-editor";
import { useDocumentValidation } from "@/features/inventory/components/document-validation-context";
import {
  formatBahtMinor,
  lineTotalMinor,
  parseUnitPriceInput,
} from "../domain/money";

export function ProductionOrderLinePrice({
  line,
  index,
  rowNumber,
  controlId,
  updateLine,
}: DocumentLineExtraFieldsContext) {
  const { errorFor } = useDocumentValidation();
  const parsedPrice = parseUnitPriceInput(line.unitPrice ?? "");
  const quantity = Number(line.quantity);
  const total = parsedPrice === null
    ? null
    : lineTotalMinor(quantity, parsedPrice);

  return (
    <>
      <Field
        id={`${controlId}-unit-price`}
        label={`ราคาต่อหน่วย รายการ ${rowNumber}`}
        type="number"
        min="0.01"
        step="0.01"
        inputMode="decimal"
        value={line.unitPrice ?? ""}
        error={errorFor(`lines.${index}.unitPrice`)}
        announceError={false}
        onChange={(event) =>
          updateLine({ unitPrice: event.target.value }, ["unitPrice"])}
      />
      <output
        className="production-line-amount"
        htmlFor={`${controlId}-quantity ${controlId}-unit-price`}
      >
        <span>จำนวนเงิน</span>
        <strong>{formatBahtMinor(total)}</strong>
      </output>
    </>
  );
}
