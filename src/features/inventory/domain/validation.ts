import { z } from "zod";
import type { StockDocumentInput, ValidationError } from "./types";

const lineSchema = z.object({
  variantId: z.string().trim().min(1),
  size: z.number().finite().positive(),
  quantity: z.number().finite().int().positive(),
  direction: z.enum(["IN", "OUT"]).optional(),
  section: z.enum(["RETURNED", "REPLACEMENT"]).optional(),
  note: z.string().optional(),
});

const documentSchema = z.object({
  type: z.enum(["RECEIPT", "SALE", "DAMAGE", "ADJUSTMENT", "EXCHANGE"]),
  effectiveDate: z.iso.date(),
  reference: z.string().optional(),
  note: z.string().optional(),
  lines: z.array(lineSchema).min(1),
});

type ValidationResult =
  | { success: true; data: StockDocumentInput }
  | { success: false; errors: ValidationError[] };

const thaiMessages = {
  required: "กรุณากรอกข้อมูลให้ครบถ้วน",
  invalidSize: "ขนาดรองเท้าต้องมากกว่า 0",
  invalidQuantity: "จำนวนต้องเป็นจำนวนเต็มบวก",
  duplicateVariant: "ไม่สามารถเลือกรุ่นรองเท้าซ้ำในรายการเดียวกันได้",
  invalidExchange: "รายการแลกเปลี่ยนต้องมีทั้งรายการคืนและรายการทดแทน",
} as const;

function toPath(path: PropertyKey[]): string {
  return path.map(String).join(".");
}

function mapSchemaError(path: string): ValidationError {
  if (path.endsWith(".size")) {
    return { path, code: "INVALID_SIZE", message: thaiMessages.invalidSize };
  }

  if (path.endsWith(".quantity")) {
    return { path, code: "INVALID_QUANTITY", message: thaiMessages.invalidQuantity };
  }

  return { path, code: "REQUIRED", message: thaiMessages.required };
}

function validateCrossLineRules(input: StockDocumentInput): ValidationError[] {
  const errors: ValidationError[] = [];
  const seen = new Set<string>();

  for (const [index, line] of input.lines.entries()) {
    const variantId = line.variantId.trim();
    const duplicateKey = input.type === "EXCHANGE" ? `${line.section}:${variantId}` : variantId;
    if (seen.has(duplicateKey)) {
      errors.push({
        path: `lines.${index}.variantId`,
        code: "DUPLICATE_VARIANT",
        message: thaiMessages.duplicateVariant,
      });
    }
    seen.add(duplicateKey);
  }

  if (input.type === "EXCHANGE") {
    const sections = new Set(input.lines.map((line) => line.section));
    for (const [index, line] of input.lines.entries()) {
      if (!line.section) {
        errors.push({
          path: `lines.${index}.section`,
          code: "INVALID_EXCHANGE",
          message: thaiMessages.invalidExchange,
        });
      }
    }

    if (!sections.has("RETURNED") || !sections.has("REPLACEMENT")) {
      errors.push({
        path: "lines",
        code: "INVALID_EXCHANGE",
        message: thaiMessages.invalidExchange,
      });
    }
  }

  return errors;
}

export function validateDocument(input: StockDocumentInput): ValidationResult {
  const parsed = documentSchema.safeParse(input);
  const crossLineErrors = Array.isArray(input.lines) ? validateCrossLineRules(input) : [];

  if (!parsed.success) {
    return {
      success: false,
      errors: [...parsed.error.issues.map((issue) => mapSchemaError(toPath(issue.path))), ...crossLineErrors],
    };
  }

  if (crossLineErrors.length > 0) {
    return { success: false, errors: crossLineErrors };
  }

  return { success: true, data: parsed.data };
}
