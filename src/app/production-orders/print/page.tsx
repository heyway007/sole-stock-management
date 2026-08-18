"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ProductionOrderPrintPageContent } from "../[id]/print/page";

function RoutedProductionOrderPrintPage() {
  const searchParams = useSearchParams();
  return <ProductionOrderPrintPageContent orderId={searchParams.get("id") ?? undefined} />;
}

export default function ProductionOrderPrintQueryPage() {
  return (
    <Suspense fallback={<div className="page-state" role="status">กำลังโหลดใบผลิตสำหรับพิมพ์…</div>}>
      <RoutedProductionOrderPrintPage />
    </Suspense>
  );
}
