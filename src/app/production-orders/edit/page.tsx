"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { EditProductionOrderPageContent } from "../[id]/edit/page";

function RoutedEditProductionOrderPage() {
  const searchParams = useSearchParams();
  return <EditProductionOrderPageContent orderId={searchParams.get("id") ?? undefined} />;
}

export default function EditProductionOrderQueryPage() {
  return (
    <Suspense fallback={<div className="page-state" role="status">กำลังโหลดใบผลิต…</div>}>
      <RoutedEditProductionOrderPage />
    </Suspense>
  );
}
