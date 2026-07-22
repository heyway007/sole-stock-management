import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { useUnsavedChanges } from "@/features/inventory/hooks/use-unsaved-changes";

function DirtyWorkflow() {
  const [draft, setDraft] = useState("");
  useUnsavedChanges(true);
  return <><label>ข้อมูลร่าง<input value={draft} onChange={(event) => setDraft(event.target.value)} /></label><a href="/issue">ไปหน้านำออก</a></>;
}

function navigateHistory(path: string) {
  window.history.replaceState({ destination: path }, "", path);
  act(() => window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state })));
}

describe("useUnsavedChanges history navigation", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("restores the workflow URL and draft when Back or Forward navigation is cancelled", async () => {
    const user = userEvent.setup();
    window.history.replaceState({ workflow: true }, "", "/receive");
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<DirtyWorkflow />);
    await user.type(screen.getByRole("textbox", { name: "ข้อมูลร่าง" }), "PO-104");

    navigateHistory("/inventory");

    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe("/receive");
    expect(screen.getByRole("textbox", { name: "ข้อมูลร่าง" })).toHaveValue("PO-104");
  });

  it("permits Back or Forward navigation when the user confirms", () => {
    window.history.replaceState({ workflow: true }, "", "/exchange");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<DirtyWorkflow />);

    navigateHistory("/inventory");

    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe("/inventory");
  });

  it("keeps the browser-exit and in-app link guards active while dirty", () => {
    window.history.replaceState({ workflow: true }, "", "/receive");
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<DirtyWorkflow />);
    const beforeUnload = new Event("beforeunload", { cancelable: true });

    window.dispatchEvent(beforeUnload);
    const followed = fireEvent.click(screen.getByRole("link", { name: "ไปหน้านำออก" }));

    expect(beforeUnload.defaultPrevented).toBe(true);
    expect(followed).toBe(false);
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe("/receive");
  });

  it("removes history listeners on unmount", () => {
    window.history.replaceState({ workflow: true }, "", "/receive");
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { unmount } = render(<DirtyWorkflow />);
    unmount();

    navigateHistory("/inventory");

    expect(window.confirm).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/inventory");
  });

  it("stops downstream router navigation when history navigation is cancelled", () => {
    window.history.replaceState({ workflow: true }, "", "/receive");
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const routerListener = vi.fn();
    window.addEventListener("popstate", routerListener);
    render(<DirtyWorkflow />);

    navigateHistory("/inventory");
    window.removeEventListener("popstate", routerListener);

    expect(routerListener).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/receive");
  });
});
