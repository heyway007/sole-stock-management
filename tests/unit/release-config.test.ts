import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import playwrightConfig from "../../playwright.config";

describe("release verification configuration", () => {
  it("uses an isolated demo server and the binding responsive viewports", () => {
    const webServer = Array.isArray(playwrightConfig.webServer)
      ? playwrightConfig.webServer[0]
      : playwrightConfig.webServer;
    const projects = new Map(playwrightConfig.projects?.map((project) => [project.name, project]));

    expect(webServer).toMatchObject({
      command: "npm run dev -- --port 3100",
      url: "http://localhost:3100",
      reuseExistingServer: false,
      env: { NEXT_PUBLIC_INVENTORY_BACKEND: "demo" },
    });
    expect(projects.get("desktop")?.use?.viewport).toEqual({ width: 1440, height: 900 });
    expect(projects.get("mobile")?.use?.viewport).toEqual({ width: 390, height: 844 });
    expect(projects.get("mobile-min")?.use?.viewport).toEqual({ width: 360, height: 800 });
  });

  it("authors safe-area clearance for the fixed mobile navigation and content", () => {
    const css = fs.readFileSync(path.resolve(process.cwd(), "src/app/globals.css"), "utf8");

    expect(css).toMatch(/\.app-main\s*\{[\s\S]*?padding-bottom:\s*calc\([^;]*env\(safe-area-inset-bottom\)\)/);
    expect(css).toMatch(/\.mobile-nav\s*\{[\s\S]*?padding-bottom:\s*env\(safe-area-inset-bottom\)/);
    expect(css).toMatch(/\.document-actions\s*\{[^}]*bottom:\s*calc\(108px\s*\+\s*env\(safe-area-inset-bottom\)\)/);
  });

  it("mounts one inventory provider above the shell instead of one provider per page", () => {
    const layout = fs.readFileSync(path.resolve(process.cwd(), "src/app/layout.tsx"), "utf8");
    expect(layout).toMatch(/<InventoryProvider>\s*<AppShell>\{children\}<\/AppShell>\s*<\/InventoryProvider>/);

    for (const route of ["page.tsx", "inventory/page.tsx", "receive/page.tsx", "issue/page.tsx", "exchange/page.tsx", "history/page.tsx", "catalog/page.tsx"]) {
      const source = fs.readFileSync(path.resolve(process.cwd(), "src/app", route), "utf8");
      expect(source).not.toMatch(/return\s+<InventoryProvider>/);
    }
  });

  it("switches populated history from mobile cards to the desktop table at 768px", () => {
    const css = fs.readFileSync(path.resolve(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toMatch(/\.history-mobile-list\s*\{[^}]*display:\s*grid/);
    expect(css).toMatch(/\.history-results\s+\.inventory-table-wrap\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(/@media\s*\(min-width:\s*768px\)[\s\S]*?\.history-results\s+\.inventory-table-wrap\s*\{[^}]*display:\s*block[\s\S]*?\.history-mobile-list\s*\{[^}]*display:\s*none/);
  });

  it("shows retained-data refresh warnings on every page that can mutate data", () => {
    for (const route of ["inventory/page.tsx", "catalog/page.tsx"]) {
      const source = fs.readFileSync(path.resolve(process.cwd(), "src/app", route), "utf8");
      expect(source).toContain("RepositoryStatusBanner");
      expect(source).toMatch(/<RepositoryStatusBanner\s*\/>/);
    }
  });
});
