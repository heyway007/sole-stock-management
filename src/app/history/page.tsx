"use client";

import { Suspense, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Eye, RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { selectHistory, type HistoryFilters } from "@/features/inventory/domain/history";
import type { MovementType } from "@/features/inventory/domain/types";
import { useInventory } from "@/features/inventory/inventory-provider";

const movementLabels: Record<MovementType, string> = {
  RECEIPT: "รับเข้า",
  SALE: "ขาย",
  DAMAGE: "ชำรุด",
  ADJUSTMENT: "ปรับยอด",
  EXCHANGE: "เปลี่ยนสินค้า",
};

const initialFilters: HistoryFilters = { query: "", type: "ALL", startDate: "", endDate: "" };

function signedPairs(value: number): string {
  return `${value > 0 ? "+" : ""}${value} คู่`;
}

export function HistoryPageContent() {
  const { snapshot, loading, error } = useInventory();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const queryVariant = searchParams.get("variant")?.trim() || null;
  const [filters, setFilters] = useState<HistoryFilters>(initialFilters);
  const [variantState, setVariantState] = useState(() => ({ query: queryVariant, selected: queryVariant }));
  if (variantState.query !== queryVariant) {
    setVariantState({ query: queryVariant, selected: queryVariant });
  }
  const variantFilter = variantState.selected;
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const rows = useMemo(() => snapshot
    ? selectHistory(snapshot, { ...filters, variantId: variantFilter ?? undefined })
    : [], [filters, snapshot, variantFilter]);
  const selectedDocument = snapshot?.documents.find((document) => document.id === selectedDocumentId) ?? null;

  function clearVariantFilter() {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("variant");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    setVariantState({ query: queryVariant, selected: null });
  }

  if (loading && !snapshot) return <div className="page-state">กำลังโหลดประวัติการเคลื่อนไหว…</div>;
  if (error && !snapshot) return <div className="page-state page-state--error" role="alert">{error}</div>;
  if (!snapshot) return null;

  const variants = new Map(snapshot.variants.map((variant) => [variant.id, variant]));
  const models = new Map(snapshot.models.map((model) => [model.id, model]));
  const colors = new Map(snapshot.colors.map((color) => [color.id, color]));
  const filteredVariant = variantFilter ? variants.get(variantFilter) : undefined;
  const filteredVariantLabel = filteredVariant
    ? `${models.get(filteredVariant.modelId)?.name ?? "ไม่พบรุ่น"} / ${colors.get(filteredVariant.colorId)?.name ?? "ไม่พบสี"} / ${filteredVariant.size}`
    : variantFilter;

  return (
    <div className="page-container history-page">
      <header className="page-header">
        <div><p className="eyebrow">บัญชีการเคลื่อนไหว</p><h1>ประวัติการเคลื่อนไหว</h1><p>ตรวจสอบเอกสารและความเปลี่ยนแปลงของสต็อกย้อนหลัง</p></div>
      </header>

      <section className="filter-bar history-filters" aria-label="ตัวกรองประวัติ">
        <Field
          id="history-search"
          type="search"
          label="ค้นหาประวัติ"
          placeholder="เลขที่เอกสาร อ้างอิง รุ่น สี หรือไซซ์"
          leadingIcon={<Search size={17} />}
          value={filters.query}
          onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
        />
        <Select
          id="history-type"
          label="ประเภทการเคลื่อนไหว"
          value={filters.type}
          onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value as HistoryFilters["type"] }))}
        >
          <option value="ALL">ทุกประเภท</option>
          {Object.entries(movementLabels).map(([type, label]) => <option value={type} key={type}>{label}</option>)}
        </Select>
        <Field id="history-start-date" type="date" label="ตั้งแต่วันที่" value={filters.startDate} onChange={(event) => setFilters((current) => ({ ...current, startDate: event.target.value }))} />
        <Field id="history-end-date" type="date" label="ถึงวันที่" value={filters.endDate} onChange={(event) => setFilters((current) => ({ ...current, endDate: event.target.value }))} />
        <Button variant="ghost" onClick={() => { setFilters(initialFilters); clearVariantFilter(); }}><RotateCcw aria-hidden size={17} />ล้างตัวกรอง</Button>
      </section>

      {variantFilter && (
        <div className="history-variant-filter" role="status">
          <span>กรองสินค้า: {filteredVariantLabel}</span>
          <button type="button" onClick={clearVariantFilter} aria-label="ยกเลิกตัวกรองสินค้า">ยกเลิก</button>
        </div>
      )}

      {rows.length ? (
        <section className="history-results" aria-label="ผลลัพธ์ประวัติ">
          <div className="inventory-table-wrap">
            <table className="inventory-table history-table" aria-label="ประวัติการเคลื่อนไหวสต็อก">
              <thead><tr><th>วันที่</th><th>เลขที่เอกสาร</th><th>ประเภท</th><th>เลขอ้างอิง</th><th>จำนวนรายการ</th><th>เปลี่ยนแปลง</th><th><span className="sr-only">รายละเอียด</span><span aria-hidden>รายละเอียด</span></th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.documentId}>
                    <td>{row.effectiveDate}</td>
                    <td><strong>{row.number}</strong></td>
                    <td><StatusBadge tone={row.pairMovement < 0 ? "warning" : "success"}>{movementLabels[row.type]}</StatusBadge></td>
                    <td>{row.reference || "—"}</td>
                    <td>{row.lineCount}</td>
                    <td><strong className={row.pairMovement < 0 ? "quantity-alert" : ""}>{signedPairs(row.pairMovement)}</strong></td>
                    <td><button className="icon-button" type="button" aria-label={`ดูรายละเอียด ${row.number}`} onClick={() => setSelectedDocumentId(row.documentId)}><Eye aria-hidden size={19} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="history-mobile-list" role="list" aria-label="ประวัติการเคลื่อนไหวแบบการ์ด">
            {rows.map((row) => (
              <article className="history-mobile-card" role="listitem" key={row.documentId}>
                <header>
                  <div><strong>{row.number}</strong><time dateTime={row.effectiveDate}>{row.effectiveDate}</time></div>
                  <StatusBadge tone={row.pairMovement < 0 ? "warning" : "success"}>{movementLabels[row.type]}</StatusBadge>
                </header>
                <dl>
                  <div><dt>เลขอ้างอิง</dt><dd>{row.reference || "—"}</dd></div>
                  <div><dt>จำนวนรายการ</dt><dd>{row.lineCount}</dd></div>
                  <div><dt>เปลี่ยนแปลง</dt><dd className={row.pairMovement < 0 ? "quantity-alert" : ""}>{signedPairs(row.pairMovement)}</dd></div>
                </dl>
                <Button
                  variant="ghost"
                  aria-label={`ดูรายละเอียด ${row.number} แบบการ์ด`}
                  onClick={() => setSelectedDocumentId(row.documentId)}
                ><Eye aria-hidden size={18} />ดูรายละเอียด</Button>
              </article>
            ))}
          </div>
        </section>
      ) : (
        <EmptyState title="ไม่พบประวัติ" description="ไม่พบเอกสารที่ตรงกัน ลองเปลี่ยนคำค้นหาหรือตัวกรอง" />
      )}

      <Modal
        open={!!selectedDocument}
        title={selectedDocument ? `รายละเอียดเอกสาร ${selectedDocument.number}` : "รายละเอียดเอกสาร"}
        description="เอกสารที่บันทึกแล้วไม่สามารถแก้ไขหรือลบได้"
        onClose={() => setSelectedDocumentId(null)}
      >
        {selectedDocument && (
          <div className="modal__body document-detail">
            <dl className="document-detail__metadata">
              <div><dt>ประเภท</dt><dd>{movementLabels[selectedDocument.type]}</dd></div>
              <div><dt>วันที่</dt><dd>{selectedDocument.effectiveDate}</dd></div>
              <div><dt>เลขอ้างอิง</dt><dd>{selectedDocument.reference || "—"}</dd></div>
              <div><dt>หมายเหตุ</dt><dd>{selectedDocument.note || "—"}</dd></div>
            </dl>
            <ul className="document-detail__lines" aria-label="รายการเคลื่อนไหวในเอกสาร">
              {selectedDocument.lines.map((line) => {
                const variant = variants.get(line.variantId);
                const modelName = variant ? models.get(variant.modelId)?.name : undefined;
                const colorName = variant ? colors.get(variant.colorId)?.name : undefined;
                return (
                  <li key={line.id}>
                    <div><strong>{modelName ?? "ไม่พบรุ่น"} / {colorName ?? "ไม่พบสี"} / {variant?.size ?? "—"}</strong>{line.section && <small>{line.section === "RETURNED" ? "รับคืน" : "สินค้าทดแทน"}</small>}</div>
                    <strong className={line.delta < 0 ? "quantity-alert" : ""}>{signedPairs(line.delta)}</strong>
                  </li>
                );
              })}
            </ul>
            <footer className="modal__footer"><Button variant="secondary" onClick={() => setSelectedDocumentId(null)}>ปิด</Button></footer>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default function HistoryPage() {
  return <Suspense fallback={<div className="page-state">กำลังโหลดประวัติการเคลื่อนไหว…</div>}><HistoryPageContent /></Suspense>;
}
