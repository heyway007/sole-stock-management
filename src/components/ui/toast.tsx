"use client";

import { CheckCircle2, X } from "lucide-react";

export function Toast({ message, onClose }: { message: string; onClose(): void }) {
  return (
    <div className="toast" role="status" aria-label="บันทึกสำเร็จ">
      <CheckCircle2 aria-hidden size={21} />
      <span>{message}</span>
      <button type="button" aria-label="ปิดข้อความ" onClick={onClose}><X aria-hidden size={18} /></button>
    </div>
  );
}
