import { expect, test, type Locator, type Page } from "playwright/test";

const desktopProject = "desktop";
const mobileProject = "mobile";

async function resetDemoStorage(page: Page) {
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

async function chooseVariant(
  editor: Locator,
  row: number,
  { model, color, size, quantity }: { model: string; color: string; size: string; quantity: string },
) {
  await editor.getByLabel(`รุ่นสินค้า รายการ ${row}`).selectOption({ label: model });
  await editor.getByLabel(`สีสินค้า รายการ ${row}`).selectOption({ label: color });
  await editor.getByLabel(`ไซซ์ รายการ ${row}`).selectOption(size);
  await editor.getByLabel(`จำนวน (คู่) รายการ ${row}`).fill(quantity);
}

async function expectNoDocumentOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))).toEqual({ clientWidth: 390, scrollWidth: 390 });
}

async function expectTouchTarget(locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, "primary control should have a rendered box").not.toBeNull();
  expect(box!.height, "primary control should be at least 44 px high").toBeGreaterThanOrEqual(44);
}

test("demo inventory workflow stays accurate on desktop and routes stay usable on mobile", async ({ page }, testInfo) => {
  expect([desktopProject, mobileProject]).toContain(testInfo.project.name);
  await resetDemoStorage(page);

  if (testInfo.project.name === desktopProject) {
    const mainNavigation = page.getByRole("navigation", { name: "เมนูหลัก" });
    await expect(mainNavigation).toBeVisible();
    await expect(page.getByRole("navigation", { name: "เมนูมือถือ" })).toBeHidden();
    await expect(page.getByRole("heading", { level: 1, name: "ภาพรวมสต็อก" })).toBeVisible();

    const stockSummary = page.getByRole("region", { name: "สรุปสต็อก" });
    await expect(stockSummary.getByText("773", { exact: true })).toBeVisible();
    await expect(stockSummary.getByText("9", { exact: true })).toBeVisible();

    await mainNavigation.getByRole("link", { name: "รับสินค้า" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "รับสินค้า" })).toBeVisible();
    const receiveEditor = page.getByRole("region", { name: "รายการสินค้า" });
    await page.getByLabel("เลขอ้างอิง").fill("E2E-RECEIVE");
    await chooseVariant(receiveEditor, 1, { model: "Paris", color: "Black", size: "38", quantity: "3" });
    await receiveEditor.getByRole("button", { name: "เพิ่มรายการ" }).click();
    await chooseVariant(receiveEditor, 2, { model: "Paris", color: "Black", size: "38.5", quantity: "4" });
    await page.getByRole("button", { name: "บันทึกรับสินค้า" }).click();
    await expect(page.getByRole("status", { name: "บันทึกสำเร็จ" })).toContainText("รับสินค้าเรียบร้อย");

    await mainNavigation.getByRole("link", { name: "นำสินค้าออก" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "นำสินค้าออก" })).toBeVisible();
    await page.getByLabel("เลขอ้างอิง").fill("E2E-SALE");
    await page.getByLabel("เหตุผลการนำออก").selectOption("SALE");
    await chooseVariant(page.getByRole("region", { name: "รายการสินค้า" }), 1, {
      model: "Paris", color: "Black", size: "38", quantity: "1",
    });
    await page.getByRole("button", { name: "บันทึกการนำออก" }).click();
    await expect(page.getByRole("status", { name: "บันทึกสำเร็จ" })).toContainText("นำสินค้าออกเรียบร้อย");

    await mainNavigation.getByRole("link", { name: "เปลี่ยนสินค้า" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "เปลี่ยนสินค้า" })).toBeVisible();
    await page.getByLabel("เลขอ้างอิง").fill("E2E-EXCHANGE");
    await chooseVariant(page.getByRole("region", { name: "สินค้าที่รับคืน" }), 1, {
      model: "Paris", color: "Black", size: "38", quantity: "1",
    });
    await chooseVariant(page.getByRole("region", { name: "สินค้าที่ส่งทดแทน" }), 1, {
      model: "Paris", color: "Black", size: "38.5", quantity: "1",
    });
    await page.getByRole("button", { name: "ตรวจสอบการเปลี่ยน" }).click();
    const exchangeDialog = page.getByRole("dialog", { name: "ยืนยันการเปลี่ยนสินค้า" });
    await expect(exchangeDialog).toContainText("+1 คู่");
    await expect(exchangeDialog).toContainText("−1 คู่");
    await exchangeDialog.getByRole("button", { name: "ยืนยันและบันทึก" }).click();
    await expect(page.getByRole("status", { name: "บันทึกสำเร็จ" })).toContainText("เปลี่ยนสินค้าเรียบร้อย");

    await mainNavigation.getByRole("link", { name: "ประวัติ" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "ประวัติการเคลื่อนไหว" })).toBeVisible();
    const history = page.getByRole("table", { name: "ประวัติการเคลื่อนไหวสต็อก" });
    await expect(history.getByRole("row")).toHaveCount(4);
    await expect(history).toContainText("E2E-RECEIVE");
    await expect(history).toContainText("E2E-SALE");
    await expect(history).toContainText("E2E-EXCHANGE");
    await expect(history.getByRole("row").filter({ hasText: "E2E-RECEIVE" })).toContainText("+7 คู่");
    await expect(history.getByRole("row").filter({ hasText: "E2E-SALE" })).toContainText("-1 คู่");
    await expect(history.getByRole("row").filter({ hasText: "E2E-EXCHANGE" })).toContainText("0 คู่");

    await mainNavigation.getByRole("link", { name: "สินค้าคงคลัง" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "สินค้าคงคลัง" })).toBeVisible();
    const inventory = page.getByRole("table", { name: "สินค้าคงคลัง" });
    const size38 = inventory.getByRole("row").filter({ hasText: "Paris" }).filter({ hasText: "Black" })
      .filter({ has: page.getByRole("cell", { name: "38", exact: true }) });
    const size385 = inventory.getByRole("row").filter({ hasText: "Paris" }).filter({ hasText: "Black" })
      .filter({ has: page.getByRole("cell", { name: "38.5", exact: true }) });
    await expect(size38.getByRole("cell", { name: "5 คู่", exact: true })).toBeVisible();
    await expect(size385.getByRole("cell", { name: "12 คู่", exact: true })).toBeVisible();
    return;
  }

  const desktopNavigation = page.getByRole("navigation", { name: "เมนูหลัก" });
  const mobileNavigation = page.getByRole("navigation", { name: "เมนูมือถือ" });
  await expect(desktopNavigation).toBeHidden();
  await expect(mobileNavigation).toBeVisible();

  const navigationChecks = [
    { name: "ภาพรวม", heading: "ภาพรวมสต็อก", primary: page.getByRole("main").getByRole("link", { name: "รับสินค้า" }).first() },
    { name: "สินค้าคงคลัง", heading: "สินค้าคงคลัง", primary: page.getByRole("searchbox", { name: "ค้นหาสินค้า" }) },
    { name: "รับสินค้า", heading: "รับสินค้า", primary: page.getByRole("button", { name: "บันทึกรับสินค้า" }) },
    { name: "นำสินค้าออก", heading: "นำสินค้าออก", primary: page.getByRole("button", { name: "บันทึกการนำออก" }) },
    { name: "เปลี่ยนสินค้า", heading: "เปลี่ยนสินค้า", primary: page.getByRole("button", { name: "ตรวจสอบการเปลี่ยน" }) },
    { name: "ประวัติ", heading: "ประวัติการเคลื่อนไหว", primary: page.getByRole("searchbox", { name: "ค้นหาประวัติ" }) },
    { name: "จัดการสินค้า", heading: "จัดการแค็ตตาล็อก", primary: page.getByRole("button", { name: "เพิ่มรุ่น" }) },
  ];

  for (const check of navigationChecks) {
    const link = mobileNavigation.getByRole("link", { name: check.name, exact: true });
    await link.scrollIntoViewIfNeeded();
    await expectTouchTarget(link);
    await link.click();
    await expect(page.getByRole("heading", { level: 1, name: check.heading })).toBeVisible();
    await expectTouchTarget(check.primary);
    await expectNoDocumentOverflow(page);
  }

  const navigationBox = await mobileNavigation.boundingBox();
  expect(navigationBox).not.toBeNull();
  expect(Math.round(navigationBox!.y + navigationBox!.height)).toBe(844);
});
