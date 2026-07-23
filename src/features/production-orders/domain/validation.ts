import { z } from "zod";
import { amountToMinor } from "./money";
import type { ProductionOrderInput, ProductionOrderValidationError } from "./types";

const schema = z.object({
  id: z.string().trim().min(1).optional(),
  orderDate: z.iso.date(),
  expectedDate: z.iso.date(),
  note: z.string(),
  lines: z.array(z.object({
    variantId: z.string().trim().min(1),
    quantity: z.number().finite().int().positive(),
    unitPrice: z.number().refine((value) => amountToMinor(value) !== null),
  })).min(1),
});

export type ProductionOrderValidationResult =
  | { success: true; data: ProductionOrderInput }
  | { success: false; errors: ProductionOrderValidationError[] };

export class ProductionOrderValidationException extends Error {
  constructor(readonly errors: ProductionOrderValidationError[]) {
    super(errors[0]?.message ?? "กรุณาตรวจสอบข้อมูลใบผลิต");
    this.name = "ProductionOrderValidationException";
  }
}

function schemaError(path: string): ProductionOrderValidationError {
  if (path.endsWith(".quantity")) {
    return {
      path,
      code: "INVALID_QUANTITY",
      message: "จำนวนต้องเป็นจำนวนเต็มมากกว่า 0",
    };
  }
  if (path.endsWith(".unitPrice")) {
    return {
      path,
      code: "INVALID_UNIT_PRICE",
      message: "ราคาต่อหน่วยต้องมากกว่า 0 และมีทศนิยมไม่เกิน 2 ตำแหน่ง",
    };
  }
  return {
    path,
    code: "REQUIRED",
    message: "กรุณากรอกข้อมูลให้ครบถ้วน",
  };
}

export function validateProductionOrder(input: ProductionOrderInput): ProductionOrderValidationResult {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      errors: parsed.error.issues.map((issue) => schemaError(issue.path.map(String).join("."))),
    };
  }

  const normalized: ProductionOrderInput = {
    ...parsed.data,
    note: parsed.data.note.trim(),
  };
  const errors: ProductionOrderValidationError[] = [];

  if (normalized.expectedDate < normalized.orderDate) {
    errors.push({
      path: "expectedDate",
      code: "INVALID_DATE_RANGE",
      message: "วันที่กำหนดรับต้องไม่ก่อนวันที่สั่งผลิต",
    });
  }

  const seen = new Set<string>();
  normalized.lines.forEach((line, index) => {
    if (seen.has(line.variantId)) {
      errors.push({
        path: `lines.${index}.variantId`,
        code: "DUPLICATE_VARIANT",
        message: "ไม่สามารถเลือกรุ่น สี และไซซ์ซ้ำในใบเดียวกันได้",
      });
    }
    seen.add(line.variantId);
  });

  if (errors.length > 0) return { success: false, errors };
  return { success: true, data: normalized };
}
