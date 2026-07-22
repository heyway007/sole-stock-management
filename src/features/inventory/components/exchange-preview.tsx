import type { DocumentVariantOption } from "@/features/inventory/components/document-line-editor";
import type { StockDocumentInput } from "@/features/inventory/domain/types";

export function ExchangePreview({ command, variants }: { command: StockDocumentInput; variants: DocumentVariantOption[] }) {
  return (
    <ul className="exchange-preview" aria-label="สรุปการเปลี่ยนสินค้า">
      {command.lines.map((line, index) => {
        const variant = variants.find((candidate) => candidate.id === line.variantId);
        const returned = line.section === "RETURNED";
        return (
          <li key={`${line.section}-${line.variantId}-${index}`}>
            <span><strong>{variant?.modelName} / {variant?.colorName}</strong><small>ไซซ์ {line.size} · {returned ? "รับคืน" : "ส่งทดแทน"}</small></span>
            <strong className={returned ? "exchange-preview__in" : "exchange-preview__out"}>{returned ? "+" : "−"}{line.quantity} คู่</strong>
          </li>
        );
      })}
    </ul>
  );
}
