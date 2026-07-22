"use client";

import Link from "next/link";
import { Edit3, History, RotateCcw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Toast } from "@/components/ui/toast";
import { RepositoryStatusBanner } from "@/features/inventory/components/repository-status-banner";
import { StockStatus } from "@/features/inventory/components/stock-status";
import { filterInventory, type InventoryFilters, type InventoryRow } from "@/features/inventory/domain/selectors";
import { useInventory } from "@/features/inventory/inventory-provider";

const initialFilters: InventoryFilters = { query: "", modelId: null, colorId: null, status: "ALL" };
const thresholdError = "กรุณากรอกจำนวนเต็มตั้งแต่ 0 ขึ้นไป";

function EditActions({ row, onEdit }: { row: InventoryRow; onEdit(row: InventoryRow): void }) {
  const label = `${row.modelName} ${row.colorName} ไซซ์ ${row.size}`;
  return (
    <div className="row-actions">
      <button className="icon-button" type="button" aria-label={`แก้ไขเกณฑ์ ${label}`} onClick={() => onEdit(row)}><Edit3 aria-hidden size={17} /></button>
      <Link className="icon-button" href={`/history?variant=${encodeURIComponent(row.variantId)}`} aria-label={`ดูประวัติ ${label}`}><History aria-hidden size={17} /></Link>
    </div>
  );
}

export function InventoryPageContent() {
  const { snapshot, loading, error: repositoryError, saveLowStockThreshold } = useInventory();
  const [filters, setFilters] = useState<InventoryFilters>(initialFilters);
  const [editingRow, setEditingRow] = useState<InventoryRow | null>(null);
  const [threshold, setThreshold] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const rows = useMemo(() => snapshot ? filterInventory(snapshot, filters) : [], [filters, snapshot]);
  const models = snapshot?.models.filter((model) => model.active) ?? [];
  const colors = snapshot?.colors.filter((color) => color.active) ?? [];

  function startEditing(row: InventoryRow) {
    setEditingRow(row);
    setThreshold(String(row.lowStockThreshold));
    setEditError(null);
  }

  function closeEditor() {
    if (saving) return;
    setEditingRow(null);
    setEditError(null);
  }

  async function saveThreshold() {
    if (!editingRow) return;
    const value = Number(threshold);
    if (!threshold.trim() || !Number.isInteger(value) || value < 0) {
      setEditError(thresholdError);
      return;
    }

    setSaving(true);
    setEditError(null);
    try {
      await saveLowStockThreshold(editingRow.variantId, value);
      setEditingRow(null);
      setToast("บันทึกเกณฑ์สต๊อกต่ำแล้ว");
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setSaving(false);
    }
  }

  if (loading && !snapshot) return <div className="page-state" role="status">กำลังโหลดข้อมูลสต็อก…</div>;
  if (repositoryError && !snapshot) return <div className="page-state page-state--error" role="alert">{repositoryError}</div>;
  if (!snapshot) return <div className="page-state" role="status">ยังไม่มีข้อมูลสต็อก</div>;

  return (
    <div className="page-container inventory-page">
      <header className="page-header inventory-header">
        <div>
          <p className="eyebrow">สินค้าทั้งหมด</p>
          <h1>สินค้าคงคลัง</h1>
          <p>ตรวจสอบจำนวนคงเหลือและตั้งค่าเกณฑ์แจ้งเตือนแต่ละไซซ์</p>
        </div>
        <span className="inventory-count"><strong>{rows.length}</strong><small>รายการ</small></span>
      </header>

      <RepositoryStatusBanner />

      <section className="filter-panel" aria-label="ค้นหาและกรองสินค้า">
        <Field
          id="inventory-search"
          type="search"
          role="searchbox"
          label="ค้นหาสินค้า"
          placeholder="ค้นหารุ่น สี หรือไซซ์"
          leadingIcon={<Search size={18} />}
          value={filters.query}
          onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
        />
        <Select label="รุ่นสินค้า" id="model-filter" value={filters.modelId ?? ""} onChange={(event) => setFilters((current) => ({ ...current, modelId: event.target.value || null }))}>
          <option value="">ทุกรุ่น</option>
          {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
        </Select>
        <Select label="สีสินค้า" id="color-filter" value={filters.colorId ?? ""} onChange={(event) => setFilters((current) => ({ ...current, colorId: event.target.value || null }))}>
          <option value="">ทุกสี</option>
          {colors.map((color) => <option key={color.id} value={color.id}>{color.name}</option>)}
        </Select>
        <Select label="สถานะสต็อก" id="status-filter" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value as InventoryFilters["status"] }))}>
          <option value="ALL">ทุกสถานะ</option>
          <option value="LOW">สต๊อกต่ำ</option>
          <option value="OUT">สินค้าหมด</option>
        </Select>
        <Button className="reset-filter" variant="ghost" onClick={() => setFilters(initialFilters)}><RotateCcw aria-hidden size={17} />ล้างตัวกรอง</Button>
      </section>

      {rows.length ? (
        <section className="inventory-results" aria-label="ผลลัพธ์สินค้าคงคลัง">
          <div className="inventory-table-wrap">
            <table className="inventory-table" aria-label="สินค้าคงคลัง">
              <thead><tr><th>รุ่น</th><th>สี</th><th>ไซซ์</th><th>คงเหลือ</th><th>เกณฑ์สต๊อกต่ำ</th><th>สถานะ</th><th><span className="sr-only">จัดการ</span><span aria-hidden>จัดการ</span></th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.variantId}>
                    <td><strong>{row.modelName}</strong></td>
                    <td>{row.colorName}</td>
                    <td>{row.size}</td>
                    <td><strong className={row.status !== "NORMAL" ? "quantity-alert" : ""}>{row.quantity}</strong> คู่</td>
                    <td>{row.lowStockThreshold} คู่</td>
                    <td><StockStatus status={row.status} /></td>
                    <td><EditActions row={row} onEdit={startEditing} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="inventory-card-list" role="list" aria-label="รายการสินค้าสำหรับมือถือ">
            {rows.map((row) => (
              <article className="inventory-card" role="listitem" key={row.variantId}>
                <header><div><h2>{row.modelName} / {row.colorName}</h2><p>ไซซ์ {row.size}</p></div><StockStatus status={row.status} /></header>
                <dl>
                  <div><dt>คงเหลือ</dt><dd className={row.status !== "NORMAL" ? "quantity-alert" : ""}>{row.quantity} คู่</dd></div>
                  <div><dt>เกณฑ์สต๊อกต่ำ</dt><dd>{row.lowStockThreshold} คู่</dd></div>
                </dl>
                <EditActions row={row} onEdit={startEditing} />
              </article>
            ))}
          </div>
        </section>
      ) : (
        <EmptyState title="ไม่พบสินค้า" description="ไม่พบสินค้าที่ตรงกับการค้นหา ลองเปลี่ยนคำค้นหาหรือตัวกรอง" />
      )}

      <Modal
        open={!!editingRow}
        title="แก้ไขเกณฑ์สต๊อกต่ำ"
        description={editingRow ? `${editingRow.modelName} / ${editingRow.colorName} · ไซซ์ ${editingRow.size}` : undefined}
        onClose={closeEditor}
      >
        <div className="modal__body">
          <Field
            id="low-stock-threshold"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            label="เกณฑ์สต๊อกต่ำ"
            value={threshold}
            error={editError}
            onChange={(event) => { setThreshold(event.target.value); if (editError) setEditError(null); }}
          />
          <p className="field-hint">ระบบจะแจ้งเตือนเมื่อจำนวนคงเหลือเท่ากับหรือต่ำกว่าค่านี้</p>
        </div>
        <footer className="modal__footer">
          <Button variant="secondary" onClick={closeEditor} disabled={saving}>ยกเลิก</Button>
          <Button onClick={() => void saveThreshold()} disabled={saving}>{saving ? "กำลังบันทึก…" : "บันทึก"}</Button>
        </footer>
      </Modal>

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}

export default function InventoryPage() {
  return <InventoryPageContent />;
}
