import { expect, test, type Locator, type Page } from "playwright/test";

const desktopProject = "desktop";
const mobileProject = "mobile";
const mobileMinProject = "mobile-min";
const mobileProjects = new Set([mobileProject, mobileMinProject]);

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

function localDateAfter(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function expectNoDocumentOverflow(page: Page) {
  const viewport = page.viewportSize();
  expect(viewport, "project should configure an explicit viewport").not.toBeNull();
  await expect.poll(() => page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))).toEqual({ clientWidth: viewport!.width, scrollWidth: viewport!.width });
}

async function expectTouchTarget(page: Page, locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box, "primary control should have a rendered box").not.toBeNull();
  expect(viewport, "project should configure an explicit viewport").not.toBeNull();
  expect(box!.width, "primary control should be at least 44 px wide").toBeGreaterThanOrEqual(44);
  expect(box!.height, "primary control should be at least 44 px high").toBeGreaterThanOrEqual(44);
  expect(box!.x, "primary control should stay inside the left viewport edge").toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, "primary control should stay inside the right viewport edge").toBeLessThanOrEqual(viewport!.width);
}

async function expectMobileNavClearance(page: Page) {
  const viewport = page.viewportSize();
  const main = page.getByRole("main");
  const mobileNavigation = page.getByRole("navigation", { name: "เมนูมือถือ" });
  const navigationBox = await mobileNavigation.boundingBox();
  const mainPaddingBottom = await main.evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingBottom));
  const lastTargetPosition = await main.locator("a,button,input,select,textarea").evaluateAll(async (elements) => {
    const visible = elements.filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    });
    const lastTarget = visible.at(-1);
    if (!lastTarget) return null;
    lastTarget.scrollIntoView({ block: "center" });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const targetBox = lastTarget.getBoundingClientRect();
    const navBox = document.querySelector(".mobile-nav")!.getBoundingClientRect();
    return { top: targetBox.top, bottom: targetBox.bottom, navTop: navBox.top };
  });

  expect(viewport, "mobile project should configure a viewport").not.toBeNull();
  expect(navigationBox, "mobile navigation should have a rendered box").not.toBeNull();
  expect(Math.round(navigationBox!.y + navigationBox!.height)).toBe(viewport!.height);
  expect(mainPaddingBottom).toBeGreaterThanOrEqual(navigationBox!.height);
  expect(lastTargetPosition, "main content should expose a visible interactive target").not.toBeNull();
  expect(lastTargetPosition!.top).toBeGreaterThanOrEqual(0);
  expect(lastTargetPosition!.bottom).toBeLessThanOrEqual(lastTargetPosition!.navTop);
}

test("demo inventory workflow stays accurate on desktop and routes stay usable on mobile", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  expect(testInfo.config.projects.map((project) => project.name).sort()).toEqual(
    [desktopProject, mobileProject, mobileMinProject].sort(),
  );
  expect(testInfo.project.use.baseURL).toBe("http://localhost:3100");
  expect([desktopProject, ...mobileProjects]).toContain(testInfo.project.name);
  await resetDemoStorage(page);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).fontFamily))
    .toContain("Kanit");

  if (testInfo.project.name === desktopProject) {
    const mainNavigation = page.getByRole("navigation", { name: "เมนูหลัก" });
    await expect(mainNavigation).toBeVisible();
    await expect(page.getByRole("navigation", { name: "เมนูมือถือ" })).toBeHidden();
    await expect(page.getByRole("heading", { level: 1, name: "ภาพรวมสต็อก" })).toBeVisible();

    const stockSummary = page.getByRole("region", { name: "สรุปสต็อก" });
    await expect(stockSummary.getByText("773", { exact: true })).toBeVisible();
    await expect(stockSummary.getByText("9", { exact: true })).toBeVisible();

    await mainNavigation.getByRole("link", { name: "จัดการสินค้า" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "จัดการแค็ตตาล็อก" })).toBeVisible();
    const models = page.getByRole("region", { name: "จัดการรุ่นรองเท้า" });
    const colors = page.getByRole("region", { name: "จัดการสี" });
    await models.getByLabel("ชื่อรุ่นใหม่").fill("E2E Runner");
    await models.getByRole("button", { name: "เพิ่มรุ่น" }).click();
    await expect(models.getByText("E2E Runner", { exact: true })).toBeVisible();
    await colors.getByLabel("ชื่อสีใหม่").fill("E2E White");
    await colors.getByRole("button", { name: "เพิ่มสี" }).click();
    await expect(colors.getByText("E2E White", { exact: true })).toBeVisible();

    await mainNavigation.getByRole("link", { name: "รับสินค้า" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "รับสินค้า" })).toBeVisible();
    const receiveEditor = page.getByRole("region", { name: "รายการสินค้า" });
    await page.getByLabel("เลขอ้างอิง").fill("E2E-RECEIVE");
    await chooseVariant(receiveEditor, 1, { model: "Paris", color: "Black", size: "XS", quantity: "3" });
    await expect(receiveEditor.getByLabel("ไซซ์ รายการ 1").locator('option[value="M"]'))
      .toHaveText("M — EU 39–40 · 24–24.5 cm");
    await receiveEditor.getByRole("button", { name: "เพิ่มรายการ" }).click();
    await chooseVariant(receiveEditor, 2, { model: "Paris", color: "Black", size: "S", quantity: "4" });
    await receiveEditor.getByRole("button", { name: "เพิ่มรายการ" }).click();
    await receiveEditor.getByLabel("รุ่นสินค้า รายการ 3").selectOption({ label: "E2E Runner" });
    await receiveEditor.getByLabel("สีสินค้า รายการ 3").selectOption({ label: "E2E White" });
    await receiveEditor.getByLabel("ไซซ์ รายการ 3").selectOption("__new__");
    await expect(receiveEditor.getByLabel("ไซซ์ใหม่ รายการ 3")).toHaveAttribute("type", "text");
    await receiveEditor.getByLabel("ไซซ์ใหม่ รายการ 3").fill("free");
    await receiveEditor.getByLabel("จำนวน (คู่) รายการ 3").fill("2");
    await receiveEditor.getByRole("button", { name: "เพิ่มรายการ" }).click();
    await receiveEditor.getByLabel("รุ่นสินค้า รายการ 4").selectOption({ label: "Weave" });
    await receiveEditor.getByLabel("สีสินค้า รายการ 4").selectOption({ label: "Black" });
    await expect(receiveEditor.getByLabel("ไซซ์ รายการ 4").locator('option[value="42"]'))
      .toHaveText("42 — 26–26.5 cm");
    await receiveEditor.getByRole("button", { name: "ลบรายการ 4" }).click();
    await page.getByRole("button", { name: "บันทึกรับสินค้า" }).click();
    await expect(page.getByRole("status", { name: "บันทึกสำเร็จ" })).toContainText("รับสินค้าเรียบร้อย");

    await mainNavigation.getByRole("link", { name: "ใบผลิตออเดอร์" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "ใบผลิตออเดอร์" })).toBeVisible();
    await page.getByRole("link", { name: "สร้างใบผลิต" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "สร้างใบผลิตออเดอร์" })).toBeVisible();
    const firstExpectedDate = localDateAfter(14);
    await page.getByLabel("วันที่กำหนดรับ").fill(firstExpectedDate);
    await page.getByLabel("หมายเหตุ").fill("ผลิตเติมสต๊อกสำหรับ E2E");
    const productionEditor = page.getByRole("region", { name: "รายการสั่งผลิต" });
    await chooseVariant(productionEditor, 1, {
      model: "E2E Runner", color: "E2E White", size: "FREE", quantity: "6",
    });
    await productionEditor.getByRole("button", { name: "เพิ่มรายการ" }).click();
    await chooseVariant(productionEditor, 2, {
      model: "Paris", color: "Black", size: "M", quantity: "5",
    });
    await page.getByRole("button", { name: "บันทึกใบผลิต" }).click();

    const firstOrderHeading = page.getByRole("heading", { level: 1 });
    await expect(firstOrderHeading).toHaveText(/^PO-/);
    const firstOrderNumber = (await firstOrderHeading.textContent())!.trim();
    await expect(page.getByText("รอรับเข้า", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "ข้อมูลใบผลิต" })).toContainText("2 รายการ");
    await expect(page.getByRole("region", { name: "ข้อมูลใบผลิต" })).toContainText("11 คู่");

    await page.getByRole("link", { name: "แก้ไข" }).click();
    const editedExpectedDate = localDateAfter(21);
    await page.getByLabel("วันที่กำหนดรับ").fill(editedExpectedDate);
    await page.getByRole("button", { name: "บันทึกใบผลิต" }).click();
    await expect(page.getByRole("heading", { level: 1, name: firstOrderNumber })).toBeVisible();
    await expect(page.getByRole("region", { name: "ข้อมูลใบผลิต" })).toContainText(editedExpectedDate);

    await page.getByRole("link", { name: "พิมพ์ใบผลิต" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "ใบผลิตออเดอร์" })).toBeVisible();
    await expect(page.locator(".production-print-page")).toContainText(firstOrderNumber);
    await expect(page.locator(".production-print-page")).toContainText("E2E Runner");
    await expect(page.locator(".production-print-page")).toContainText("FREE");
    await expect(page.locator(".production-print-page")).toContainText("M");
    await expect(page.locator(".production-print-page")).not.toContainText("24–24.5 cm");
    await expect(page.locator(".production-print-page")).toContainText("11 คู่");
    await page.emulateMedia({ media: "print" });
    await expect(page.locator(".sidebar")).toBeHidden();
    await expect(page.locator(".mobile-nav")).toBeHidden();
    await expect(page.locator(".print-controls")).toBeHidden();
    await expect(page.locator(".production-print-page")).toBeVisible();
    await page.emulateMedia({ media: "screen" });
    await page.getByRole("link", { name: "กลับไปใบผลิต" }).click();

    await page.getByRole("button", { name: "รับเข้าสต๊อก" }).click();
    const receiveProductionDialog = page.getByRole("dialog", { name: "ยืนยันรับเข้าสต๊อก" });
    await expect(receiveProductionDialog).toContainText("11 คู่");
    await receiveProductionDialog.getByRole("button", { name: "ยืนยันรับเข้าสต๊อก" }).click();
    const receiveSuccessDialog = page.getByRole("dialog", { name: "รับเข้าสต๊อกแล้ว" });
    const successText = await receiveSuccessDialog.textContent();
    const receiptNumber = successText?.match(/STK-\d{8}-\d{4}/)?.[0];
    expect(receiptNumber, "the receipt document number should be shown").toBeTruthy();
    await receiveSuccessDialog.getByRole("button", { name: "ตกลง" }).click();
    await expect(page.getByText("รับเข้าแล้ว", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "แก้ไข" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "รับเข้าสต๊อก" })).toHaveCount(0);

    await page.getByRole("link", { name: /เอกสารรับเข้า|STK-/ }).click();
    const receiptDetail = page.getByRole("dialog", { name: `รายละเอียดเอกสาร ${receiptNumber}` });
    await expect(receiptDetail).toContainText(firstOrderNumber);
    await receiptDetail.getByRole("button", { name: "ปิด", exact: true }).click();
    await page.goto("/production-orders");
    await page.getByRole("link", { name: "สร้างใบผลิต" }).click();
    await page.getByLabel("วันที่กำหนดรับ").fill(localDateAfter(10));
    await chooseVariant(page.getByRole("region", { name: "รายการสั่งผลิต" }), 1, {
      model: "Paris", color: "Black", size: "M", quantity: "4",
    });
    await page.getByRole("button", { name: "บันทึกใบผลิต" }).click();
    const cancelledOrderHeading = page.getByRole("heading", { level: 1 });
    await expect(cancelledOrderHeading).toHaveText(/^PO-/);
    const cancelledOrderNumber = (await cancelledOrderHeading.textContent())!.trim();
    await page.getByRole("button", { name: "ยกเลิกใบผลิต" }).click();
    const cancelDialog = page.getByRole("dialog", { name: "ยืนยันยกเลิกใบผลิต" });
    await cancelDialog.getByRole("button", { name: "ยืนยันยกเลิกใบผลิต" }).click();
    const cancelSuccessDialog = page.getByRole("dialog", { name: "ยกเลิกใบผลิตแล้ว" });
    await cancelSuccessDialog.getByRole("button", { name: "ตกลง" }).click();
    await expect(page.getByRole("heading", { level: 1, name: cancelledOrderNumber })).toBeVisible();
    await expect(page.getByText("ยกเลิก", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "แก้ไข" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "รับเข้าสต๊อก" })).toHaveCount(0);

    await mainNavigation.getByRole("link", { name: "สินค้าคงคลัง" }).click();
    const productionInventory = page.getByRole("table", { name: "สินค้าคงคลัง" });
    const producedSizeM = productionInventory.getByRole("row").filter({ hasText: "Paris" }).filter({ hasText: "Black" })
      .filter({ has: page.getByRole("cell", { name: "M", exact: true }) });
    const producedRunner = productionInventory.getByRole("row").filter({ hasText: "E2E Runner" }).filter({ hasText: "E2E White" });
    await expect(producedSizeM.getByRole("cell", { name: "15 คู่", exact: true })).toBeVisible();
    await expect(producedRunner.getByRole("cell", { name: "8 คู่", exact: true })).toBeVisible();

    await mainNavigation.getByRole("link", { name: "นำสินค้าออก" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "นำสินค้าออก" })).toBeVisible();
    await page.getByLabel("เลขอ้างอิง").fill("E2E-SALE");
    await page.getByLabel("เหตุผลการนำออก").selectOption("SALE");
    await chooseVariant(page.getByRole("region", { name: "รายการสินค้า" }), 1, {
      model: "Paris", color: "Black", size: "XS", quantity: "1",
    });
    await page.getByRole("button", { name: "บันทึกการนำออก" }).click();
    await expect(page.getByRole("status", { name: "บันทึกสำเร็จ" })).toContainText("นำสินค้าออกเรียบร้อย");

    await mainNavigation.getByRole("link", { name: "เปลี่ยนสินค้า" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "เปลี่ยนสินค้า" })).toBeVisible();
    await page.getByLabel("เลขอ้างอิง").fill("E2E-EXCHANGE");
    await chooseVariant(page.getByRole("region", { name: "สินค้าที่รับคืน" }), 1, {
      model: "Paris", color: "Black", size: "XS", quantity: "1",
    });
    await chooseVariant(page.getByRole("region", { name: "สินค้าที่ส่งทดแทน" }), 1, {
      model: "Paris", color: "Black", size: "S", quantity: "1",
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
    await expect(history.getByRole("row")).toHaveCount(5);
    await expect(history).toContainText("E2E-RECEIVE");
    await expect(history).toContainText("E2E-SALE");
    await expect(history).toContainText("E2E-EXCHANGE");
    await expect(history.getByText(firstOrderNumber, { exact: true })).toHaveCount(1);
    await expect(history.getByRole("row").filter({ hasText: "E2E-RECEIVE" })).toContainText("+9 คู่");
    await expect(history.getByRole("row").filter({ hasText: "E2E-SALE" })).toContainText("-1 คู่");
    await expect(history.getByRole("row").filter({ hasText: "E2E-EXCHANGE" })).toContainText("0 คู่");

    await mainNavigation.getByRole("link", { name: "สินค้าคงคลัง" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "สินค้าคงคลัง" })).toBeVisible();
    const inventory = page.getByRole("table", { name: "สินค้าคงคลัง" });
    const sizeXs = inventory.getByRole("row").filter({ hasText: "Paris" }).filter({ hasText: "Black" })
      .filter({ has: page.getByRole("cell", { name: "XS", exact: true }) });
    const sizeS = inventory.getByRole("row").filter({ hasText: "Paris" }).filter({ hasText: "Black" })
      .filter({ has: page.getByRole("cell", { name: "S", exact: true }) });
    await expect(sizeXs.getByRole("cell", { name: "5 คู่", exact: true })).toBeVisible();
    await expect(sizeS.getByRole("cell", { name: "12 คู่", exact: true })).toBeVisible();
    const newVariant = inventory.getByRole("row").filter({ hasText: "E2E Runner" }).filter({ hasText: "E2E White" });
    await expect(newVariant.getByRole("cell", { name: "FREE", exact: true })).toBeVisible();
    await expect(newVariant.getByRole("cell", { name: "8 คู่", exact: true })).toBeVisible();

    const inventorySummary = page.getByRole("group", { name: "สรุปสินค้าคงคลัง" });
    await page.getByRole("button", { name: "ล้างสต๊อก" }).click();
    const clearDialog = page.getByRole("dialog", { name: "ยืนยันล้างสต๊อก" });
    await clearDialog.getByRole("textbox", { name: "พิมพ์คำยืนยันล้างสต๊อก" }).fill("ล้าง stock");
    await clearDialog.getByRole("button", { name: "ยืนยันล้างสต๊อก" }).click();
    await expect(clearDialog).toContainText("กรุณาพิมพ์ ล้างสต๊อก ให้ตรงกัน");
    await clearDialog.getByRole("textbox", { name: "พิมพ์คำยืนยันล้างสต๊อก" }).fill("ล้างสต๊อก");
    await clearDialog.getByRole("button", { name: "ยืนยันล้างสต๊อก" }).click();

    const successDialog = page.getByRole("dialog", { name: "ล้างสต๊อกแล้ว" });
    await expect(successDialog).toContainText("คู่");
    await successDialog.getByRole("button", { name: "ตกลง" }).click();
    await expect(inventorySummary.getByText("0", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "ล้างสต๊อก" })).toBeDisabled();

    await mainNavigation.getByRole("link", { name: "ประวัติ" }).click();
    const clearedHistory = page.getByRole("table", { name: "ประวัติการเคลื่อนไหวสต็อก" });
    await expect(clearedHistory.locator("tbody tr").filter({ hasText: "CLEAR-STOCK" })).toContainText("ปรับยอด");

    await mainNavigation.getByRole("link", { name: "จัดการสินค้า" }).click();
    await expect(page.getByRole("region", { name: "จัดการรุ่นรองเท้า" })).toContainText("E2E Runner");
    await expect(page.getByRole("region", { name: "จัดการสี" })).toContainText("E2E White");
    return;
  }

  const desktopNavigation = page.getByRole("navigation", { name: "เมนูหลัก" });
  const mobileNavigation = page.getByRole("navigation", { name: "เมนูมือถือ" });
  await expect(desktopNavigation).toBeHidden();
  await expect(mobileNavigation).toBeVisible();

  const receiveLink = mobileNavigation.getByRole("link", { name: "รับสินค้า", exact: true });
  await receiveLink.scrollIntoViewIfNeeded();
  await receiveLink.click();
  await expect(page.getByRole("heading", { level: 1, name: "รับสินค้า" })).toBeVisible();
  const mobileReceiveEditor = page.getByRole("region", { name: "รายการสินค้า" });
  await page.getByLabel("เลขอ้างอิง").fill("E2E-MOBILE");
  await mobileReceiveEditor.getByLabel("รุ่นสินค้า รายการ 1").selectOption({ label: "Paris" });
  await mobileReceiveEditor.getByLabel("สีสินค้า รายการ 1").selectOption({ label: "Black" });
  await mobileReceiveEditor.getByLabel("ไซซ์ รายการ 1").selectOption("__new__");
  const mobileCustomSize = mobileReceiveEditor.getByLabel("ไซซ์ใหม่ รายการ 1");
  await expectTouchTarget(page, mobileCustomSize);
  await expect(mobileCustomSize).toHaveAttribute("type", "text");
  await mobileCustomSize.fill("m/l");
  await mobileReceiveEditor.getByLabel("จำนวน (คู่) รายการ 1").fill("1");
  await page.getByRole("button", { name: "บันทึกรับสินค้า" }).click();
  await expect(page.getByRole("status", { name: "บันทึกสำเร็จ" })).toContainText("รับสินค้าเรียบร้อย");
  // The Next.js development toolbar occupies the bottom-left corner where the
  // dashboard tab lives. A real navigation keeps the demo repository storage
  // intact without making this assertion depend on that development-only UI.
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "ภาพรวมสต็อก" })).toBeVisible();

  const navigationChecks = [
    { name: "ภาพรวม", heading: "ภาพรวมสต็อก", primary: page.getByRole("main").getByRole("link", { name: "รับสินค้า" }).first() },
    { name: "สินค้าคงคลัง", heading: "สินค้าคงคลัง", primary: page.getByRole("searchbox", { name: "ค้นหาสินค้า" }) },
    { name: "รับสินค้า", heading: "รับสินค้า", primary: page.getByRole("button", { name: "บันทึกรับสินค้า" }) },
    { name: "นำสินค้าออก", heading: "นำสินค้าออก", primary: page.getByRole("button", { name: "บันทึกการนำออก" }) },
    { name: "เปลี่ยนสินค้า", heading: "เปลี่ยนสินค้า", primary: page.getByRole("button", { name: "ตรวจสอบการเปลี่ยน" }) },
    { name: "ประวัติ", heading: "ประวัติการเคลื่อนไหว", primary: page.getByRole("searchbox", { name: "ค้นหาประวัติ" }) },
    { name: "ใบผลิตออเดอร์", heading: "ใบผลิตออเดอร์", primary: page.getByRole("link", { name: "สร้างใบผลิต" }) },
    { name: "จัดการสินค้า", heading: "จัดการแค็ตตาล็อก", primary: page.getByRole("button", { name: "เพิ่มรุ่น" }) },
  ];

  for (const check of navigationChecks) {
    const link = mobileNavigation.getByRole("link", { name: check.name, exact: true });
    await link.scrollIntoViewIfNeeded();
    await expectTouchTarget(page, link);
    if (check.name === "ภาพรวม") {
      await expect(link).toHaveAttribute("aria-current", "page");
    } else {
      await link.click();
    }
    await expect(page.getByRole("heading", { level: 1, name: check.heading })).toBeVisible();
    if (check.name === "ประวัติ") {
      const cards = page.getByRole("list", { name: "ประวัติการเคลื่อนไหวแบบการ์ด" });
      await expect(cards).toBeVisible();
      await expect(cards.getByRole("listitem")).toHaveCount(1);
      await expect(cards).toContainText("E2E-MOBILE");
      await expect(page.getByRole("table", { name: "ประวัติการเคลื่อนไหวสต็อก" })).toBeHidden();
      await cards.getByRole("button", { name: /แบบการ์ด/ }).click();
      await expect(page.getByRole("dialog", { name: /รายละเอียดเอกสาร/ })).toContainText("E2E-MOBILE");
      await page.getByRole("button", { name: "ปิดหน้าต่าง" }).click();
    }
    if (check.name === "สินค้าคงคลัง") {
      await expectTouchTarget(page, page.getByRole("button", { name: "ล้างสต๊อก" }));
    }
    if (check.name === "ใบผลิตออเดอร์") {
      const createLink = page.getByRole("link", { name: "สร้างใบผลิต" });
      await expectTouchTarget(page, createLink);
      await createLink.click();
      await expect(page.getByRole("heading", { level: 1, name: "สร้างใบผลิตออเดอร์" })).toBeVisible();
      await page.getByLabel("วันที่กำหนดรับ").fill(localDateAfter(7));
      await chooseVariant(page.getByRole("region", { name: "รายการสั่งผลิต" }), 1, {
        model: "Paris", color: "Black", size: "M", quantity: "1",
      });
      await page.getByRole("button", { name: "บันทึกใบผลิต" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^PO-/);
      await expect(page.getByRole("list", { name: "รายการในใบผลิตสำหรับมือถือ" })).toBeVisible();
      await expectNoDocumentOverflow(page);

      await page.getByRole("link", { name: "พิมพ์ใบผลิต" }).click();
      await expect(page.locator(".production-print-page")).toBeVisible();
      await expectNoDocumentOverflow(page);
      await page.emulateMedia({ media: "print" });
      await expect(page.locator(".mobile-nav")).toBeHidden();
      await expect(page.locator(".print-controls")).toBeHidden();
      await expect(page.locator(".production-print-page")).toBeVisible();
      await page.emulateMedia({ media: "screen" });

      await page.goto("/production-orders");
      const orderCards = page.getByRole("list", { name: "รายการใบผลิตสำหรับมือถือ" });
      await expect(orderCards).toBeVisible();
      await expect(orderCards.getByRole("listitem")).toHaveCount(1);
      await expectNoDocumentOverflow(page);
    }
    await expectTouchTarget(page, check.primary);
    await expectNoDocumentOverflow(page);
    await expectMobileNavClearance(page);
  }
});
