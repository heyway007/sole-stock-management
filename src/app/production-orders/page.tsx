"use client";

import Link from "next/link";
import { Plus, RotateCcw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { ProductionOrderStatus } from "@/features/production-orders/components/production-order-status";
import {
  filterProductionOrders,
  summarizeProductionOrder,
  type ProductionOrderFilters,
} from "@/features/production-orders/domain/selectors";
import { useProductionOrders } from "@/features/production-orders/production-order-provider";

const initialFilters: ProductionOrderFilters = { query: "", status: "ALL" };

function OrderSummary({ lineCount, totalPairs }: { lineCount: number; totalPairs: number }) {
  return (
    <div className="production-order-summary" role="group" aria-label="สรุปใบผลิต">
      <span className="inventory-count"><strong>{lineCount}</strong><small>รายการ</small></span>
      <span className="inventory-count"><strong>{totalPairs}</strong><small>คู่</small></span>
    </div>
  );
}

export function ProductionOrdersPageContent() {
  const { orders, loading, error, warning, refresh } = useProductionOrders();
  const [filters, setFilters] = useState<ProductionOrderFilters>(initialFilters);
  const filteredOrders = useMemo(
    () => orders ? filterProductionOrders(orders, filters) : [],
    [filters, orders],
  );
  const summary = useMemo(() => filteredOrders.reduce(
    (total, order) => {
      const current = summarizeProductionOrder(order);
      return {
        lineCount: total.lineCount + current.lineCount,
        totalPairs: total.totalPairs + current.totalPairs,
      };
    },
    { lineCount: 0, totalPairs: 0 },
  ), [filteredOrders]);

  if (loading && !orders) {
    return <div className="page-state" role="status">กำลังโหลดใบผลิตออเดอร์…</div>;
  }
  if (error && !orders) {
    return (
      <div className="page-state page-state--error" role="alert">
        <p>{error}</p>
        <Button variant="secondary" onClick={() => void refresh()}>ลองใหม่</Button>
      </div>
    );
  }
  if (!orders) return null;

  return (
    <div className="page-container production-orders-page">
      <header className="page-header production-orders-header">
        <div>
          <p className="eyebrow">วางแผนการผลิต</p>
          <h1>ใบผลิตออเดอร์</h1>
          <p>สร้าง พิมพ์ และติดตามรายการรองเท้าที่สั่งผลิตก่อนรับเข้าสต๊อก</p>
        </div>
        <div className="production-orders-header__actions">
          <OrderSummary {...summary} />
          <Link className="button button--primary production-create-link" href="/production-orders/new">
            <Plus aria-hidden size={18} />สร้างใบผลิต
          </Link>
        </div>
      </header>

      {warning && <div className="repository-status-banner" role="alert">{warning}</div>}

      <section className="production-order-filters" aria-label="ค้นหาและกรองใบผลิต">
        <Field
          id="production-order-search"
          type="search"
          role="searchbox"
          label="ค้นหาใบผลิต"
          placeholder="เลขที่ใบผลิต รุ่น สี หรือไซซ์"
          leadingIcon={<Search aria-hidden size={18} />}
          value={filters.query}
          onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
        />
        <Select
          id="production-order-status-filter"
          label="สถานะใบผลิต"
          value={filters.status}
          onChange={(event) => setFilters((current) => ({
            ...current,
            status: event.target.value as ProductionOrderFilters["status"],
          }))}
        >
          <option value="ALL">ทุกสถานะ</option>
          <option value="OPEN">รอรับเข้า</option>
          <option value="RECEIVED">รับเข้าแล้ว</option>
          <option value="CANCELLED">ยกเลิก</option>
        </Select>
        <Button variant="ghost" onClick={() => setFilters(initialFilters)}>
          <RotateCcw aria-hidden size={17} />ล้างตัวกรอง
        </Button>
      </section>

      {filteredOrders.length > 0 ? (
        <section className="production-order-results" aria-label="ผลลัพธ์ใบผลิต">
          <div className="inventory-table-wrap production-order-table-wrap">
            <table className="inventory-table production-order-table" aria-label="รายการใบผลิตออเดอร์">
              <thead>
                <tr>
                  <th>เลขที่ใบผลิต</th>
                  <th>วันที่สั่งผลิต</th>
                  <th>กำหนดรับ</th>
                  <th>จำนวนรายการ</th>
                  <th>จำนวนคู่</th>
                  <th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => {
                  const orderSummary = summarizeProductionOrder(order);
                  return (
                    <tr key={order.id}>
                      <td><Link href={`/production-orders/${order.id}`}><strong>{order.number}</strong></Link></td>
                      <td>{order.orderDate}</td>
                      <td>{order.expectedDate}</td>
                      <td>{orderSummary.lineCount} รายการ</td>
                      <td><strong>{orderSummary.totalPairs}</strong> คู่</td>
                      <td><ProductionOrderStatus status={order.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="production-order-card-list" role="list" aria-label="รายการใบผลิตสำหรับมือถือ">
            {filteredOrders.map((order) => {
              const orderSummary = summarizeProductionOrder(order);
              return (
                <Link className="production-order-card" href={`/production-orders/${order.id}`} role="listitem" key={order.id}>
                  <header>
                    <div><strong>{order.number}</strong><span>กำหนดรับ {order.expectedDate}</span></div>
                    <ProductionOrderStatus status={order.status} />
                  </header>
                  <dl>
                    <div><dt>วันที่สั่งผลิต</dt><dd>{order.orderDate}</dd></div>
                    <div><dt>จำนวนรายการ</dt><dd>{orderSummary.lineCount} รายการ</dd></div>
                    <div><dt>จำนวนทั้งหมด</dt><dd>{orderSummary.totalPairs} คู่</dd></div>
                  </dl>
                </Link>
              );
            })}
          </div>
        </section>
      ) : (
        <EmptyState title="ไม่พบใบผลิต" description="ไม่พบใบผลิตที่ตรงกับคำค้นหาหรือสถานะที่เลือก" />
      )}
    </div>
  );
}

export default function ProductionOrdersPage() {
  return <ProductionOrdersPageContent />;
}
