"use client";

import { useMemo, useState, type FormEvent, type PropsWithChildren, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { useUnsavedChanges } from "@/features/inventory/hooks/use-unsaved-changes";

export interface DocumentMetadata {
  effectiveDate: string;
  reference: string;
  note: string;
}

interface DocumentFormProps extends PropsWithChildren {
  title: string;
  description: string;
  eyebrow: string;
  submitLabel: string;
  dirty: boolean;
  beforeLines?: ReactNode;
  onSubmit(metadata: DocumentMetadata): Promise<void | false>;
}

function localDateValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function DocumentForm({ title, description, eyebrow, submitLabel, dirty, beforeLines, onSubmit, children }: DocumentFormProps) {
  const initialDate = useMemo(() => localDateValue(), []);
  const [effectiveDate, setEffectiveDate] = useState(initialDate);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const metadataDirty = effectiveDate !== initialDate || reference.trim() !== "" || note.trim() !== "";
  useUnsavedChanges(dirty || metadataDirty);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const result = await onSubmit({ effectiveDate, reference: reference.trim(), note: note.trim() });
      if (result !== false) {
        setEffectiveDate(initialDate);
        setReference("");
        setNote("");
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page-container workflow-page">
      <header className="page-header">
        <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>
      </header>
      <form className="document-form" onSubmit={(event) => void submit(event)}>
        <section className="document-card document-metadata" aria-label="ข้อมูลเอกสาร">
          <Field label="วันที่มีผล" type="date" required value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} />
          <Field label="เลขอ้างอิง" value={reference} onChange={(event) => setReference(event.target.value)} />
          <label className="form-field document-note">
            <span className="form-field__label">หมายเหตุ</span>
            <span className="form-field__control"><textarea value={note} onChange={(event) => setNote(event.target.value)} /></span>
          </label>
        </section>
        {beforeLines}
        {children}
        {formError && <div className="form-error-banner" role="alert">{formError}</div>}
        <footer className="document-actions"><Button type="submit" disabled={submitting}>{submitting ? "กำลังบันทึก…" : submitLabel}</Button></footer>
      </form>
    </div>
  );
}
