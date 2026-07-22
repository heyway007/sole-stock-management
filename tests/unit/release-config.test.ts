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
  });
});
