"use client";

import { useState, type FormEvent } from "react";
import { Pencil, Power, PowerOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { StatusBadge } from "@/components/ui/status-badge";
import { Toast } from "@/components/ui/toast";
import type { Color, ShoeModel } from "@/features/inventory/domain/types";
import { InventoryProvider, useInventory } from "@/features/inventory/inventory-provider";

type CatalogKind = "model" | "color";
type CatalogItem = { kind: CatalogKind; id: string; name: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่อีกครั้ง";
}

export function CatalogPageContent() {
  const { snapshot, loading, error, catalog } = useInventory();
  const [newModelName, setNewModelName] = useState("");
  const [newColorName, setNewColorName] = useState("");
  const [modelError, setModelError] = useState<string | null>(null);
  const [colorError, setColorError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingError, setEditingError] = useState<string | null>(null);
  const [pendingDeactivation, setPendingDeactivation] = useState<CatalogItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  if (loading && !snapshot) return <div className="page-state">กำลังโหลดแค็ตตาล็อก…</div>;
  if (error && !snapshot) return <div className="page-state page-state--error" role="alert">{error}</div>;
  if (!snapshot) return null;

  async function addItem(event: FormEvent, kind: CatalogKind) {
    event.preventDefault();
    const name = kind === "model" ? newModelName : newColorName;
    const setError = kind === "model" ? setModelError : setColorError;
    setError(null);
    setSaving(true);
    try {
      if (kind === "model") {
        const created = await catalog.addModel(name);
        setNewModelName("");
        setToast(`เพิ่มรุ่น ${created.name} แล้ว`);
      } else {
        const created = await catalog.addColor(name);
        setNewColorName("");
        setToast(`เพิ่มสี ${created.name} แล้ว`);
      }
    } catch (mutationError) {
      setError(errorMessage(mutationError));
    } finally {
      setSaving(false);
    }
  }

  function startEditing(item: CatalogItem) {
    setEditing(item);
    setEditingName(item.name);
    setEditingError(null);
  }

  async function saveRename() {
    if (!editing) return;
    setSaving(true);
    setEditingError(null);
    try {
      if (editing.kind === "model") await catalog.renameModel(editing.id, editingName);
      else await catalog.renameColor(editing.id, editingName);
      setToast(`เปลี่ยนชื่อ${editing.kind === "model" ? "รุ่น" : "สี"}แล้ว`);
      setEditing(null);
    } catch (mutationError) {
      setEditingError(errorMessage(mutationError));
    } finally {
      setSaving(false);
    }
  }

  async function setActive(item: CatalogItem, active: boolean) {
    setSaving(true);
    try {
      if (item.kind === "model") await catalog.setModelActive(item.id, active);
      else await catalog.setColorActive(item.id, active);
      setToast(`${active ? "เปิด" : "ปิด"}ใช้งาน${item.kind === "model" ? "รุ่น" : "สี"} ${item.name} แล้ว`);
      setPendingDeactivation(null);
    } catch (mutationError) {
      setToast(errorMessage(mutationError));
    } finally {
      setSaving(false);
    }
  }

  function renderRows(kind: CatalogKind, records: Array<ShoeModel | Color>) {
    const noun = kind === "model" ? "รุ่น" : "สี";
    return (
      <ul className="catalog-list">
        {records.map((record) => {
          const item = { kind, id: record.id, name: record.name };
          return (
            <li className="catalog-row" key={record.id}>
              <div><strong>{record.name}</strong><StatusBadge tone={record.active ? "success" : "neutral"}>{record.active ? "ใช้งาน" : "ปิดใช้งาน"}</StatusBadge></div>
              <div className="catalog-row__actions">
                {record.active ? (
                  <>
                    <Button variant="ghost" aria-label={`เปลี่ยนชื่อ${noun} ${record.name}`} onClick={() => startEditing(item)}><Pencil aria-hidden size={16} />เปลี่ยนชื่อ</Button>
                    <Button variant="secondary" aria-label={`ปิดใช้งาน${noun} ${record.name}`} onClick={() => setPendingDeactivation(item)}><PowerOff aria-hidden size={16} />ปิดใช้งาน</Button>
                  </>
                ) : (
                  <Button variant="secondary" aria-label={`เปิดใช้งาน${noun} ${record.name}`} onClick={() => void setActive(item, true)} disabled={saving}><Power aria-hidden size={16} />เปิดใช้งาน</Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="page catalog-page">
      <header className="page-header">
        <div><p className="eyebrow">Product catalog</p><h1>จัดการแค็ตตาล็อก</h1><p>เพิ่ม เปลี่ยนชื่อ และกำหนดสถานะรุ่นรองเท้ากับสี</p></div>
      </header>

      <div className="catalog-grid">
        <section className="catalog-card" aria-label="จัดการรุ่นรองเท้า">
          <header><div><h2>รุ่นรองเท้า</h2><p>รุ่นที่ใช้สร้างรายการสินค้า</p></div><span>{snapshot.models.length} รุ่น</span></header>
          <form className="catalog-add-form" onSubmit={(event) => void addItem(event, "model")}>
            <Field id="new-model-name" label="ชื่อรุ่นใหม่" value={newModelName} error={modelError} onChange={(event) => { setNewModelName(event.target.value); setModelError(null); }} />
            <Button type="submit" disabled={saving}>เพิ่มรุ่น</Button>
          </form>
          {renderRows("model", snapshot.models)}
        </section>

        <section className="catalog-card" aria-label="จัดการสี">
          <header><div><h2>สี</h2><p>สีที่ใช้ร่วมกับรุ่นรองเท้า</p></div><span>{snapshot.colors.length} สี</span></header>
          <form className="catalog-add-form" onSubmit={(event) => void addItem(event, "color")}>
            <Field id="new-color-name" label="ชื่อสีใหม่" value={newColorName} error={colorError} onChange={(event) => { setNewColorName(event.target.value); setColorError(null); }} />
            <Button type="submit" disabled={saving}>เพิ่มสี</Button>
          </form>
          {renderRows("color", snapshot.colors)}
        </section>
      </div>

      <Modal
        open={!!editing}
        title={editing ? `เปลี่ยนชื่อ${editing.kind === "model" ? "รุ่น" : "สี"} ${editing.name}` : "เปลี่ยนชื่อ"}
        onClose={() => { if (!saving) setEditing(null); }}
      >
        {editing && (
          <div className="modal__body">
            <Field
              id="catalog-rename"
              label={editing.kind === "model" ? "ชื่อรุ่น" : "ชื่อสี"}
              value={editingName}
              error={editingError}
              onChange={(event) => { setEditingName(event.target.value); setEditingError(null); }}
            />
            <footer className="modal__footer">
              <Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>ยกเลิก</Button>
              <Button onClick={() => void saveRename()} disabled={saving}>{saving ? "กำลังบันทึก…" : "บันทึกชื่อ"}</Button>
            </footer>
          </div>
        )}
      </Modal>

      <Modal
        open={!!pendingDeactivation}
        title={pendingDeactivation ? `ยืนยันปิดใช้งาน${pendingDeactivation.kind === "model" ? "รุ่น" : "สี"} ${pendingDeactivation.name}` : "ยืนยันปิดใช้งาน"}
        description="ข้อมูลสินค้าและประวัติเดิมจะยังคงอยู่ และสามารถเปิดใช้งานอีกครั้งได้"
        onClose={() => { if (!saving) setPendingDeactivation(null); }}
      >
        <footer className="modal__footer">
          <Button variant="secondary" onClick={() => setPendingDeactivation(null)} disabled={saving}>ยกเลิก</Button>
          <Button onClick={() => { if (pendingDeactivation) void setActive(pendingDeactivation, false); }} disabled={saving}>{saving ? "กำลังบันทึก…" : "ยืนยันปิดใช้งาน"}</Button>
        </footer>
      </Modal>

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}

export default function CatalogPage() {
  return <InventoryProvider><CatalogPageContent /></InventoryProvider>;
}
