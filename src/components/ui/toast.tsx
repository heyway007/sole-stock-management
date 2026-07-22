"use client";

import { CircleAlert, CheckCircle2, X } from "lucide-react";

interface ToastProps {
  message: string;
  tone?: "success" | "error";
  onClose(): void;
}

export function Toast({ message, tone = "success", onClose }: ToastProps) {
  const isError = tone === "error";
  return (
    <div className={`toast toast--${tone}`} role={isError ? "alert" : "status"} aria-label={isError ? "เกิดข้อผิดพลาด" : "บันทึกสำเร็จ"}>
      {isError ? <CircleAlert aria-hidden size={21} /> : <CheckCircle2 aria-hidden size={21} />}
      <span>{message}</span>
      <button type="button" aria-label={isError ? "ปิดข้อความข้อผิดพลาด" : "ปิดข้อความ"} onClick={onClose}><X aria-hidden size={18} /></button>
    </div>
  );
}
