"use client";

import { useEffect } from "react";

const leaveMessage = "มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้หรือไม่";

export function useUnsavedChanges(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    let acceptedUrl = window.location.href;
    let acceptedState: unknown = window.history.state;

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    function handleNavigation(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      const link = target instanceof Element ? target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const destination = new URL(link.href, window.location.href);
      if (destination.origin !== window.location.origin || destination.href === window.location.href) return;
      if (!window.confirm(leaveMessage)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }

    function handleHistoryNavigation(event: PopStateEvent) {
      const destination = window.location.href;
      if (destination === acceptedUrl) return;
      if (window.confirm(leaveMessage)) {
        acceptedUrl = destination;
        acceptedState = event.state;
        return;
      }
      window.history.pushState(acceptedState, "", acceptedUrl);
      event.stopImmediatePropagation();
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("popstate", handleHistoryNavigation, true);
    document.addEventListener("click", handleNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("popstate", handleHistoryNavigation, true);
      document.removeEventListener("click", handleNavigation, true);
    };
  }, [dirty]);
}
