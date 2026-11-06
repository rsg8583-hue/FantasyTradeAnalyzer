"use client";

import { useEffect, useRef } from "react";

/**
 * Calls `onPoll` every `intervalMs` while the page is visible. Polling stops
 * when the tab is hidden and resumes (with an immediate poll if one is due)
 * when it becomes visible again. `intervalMs = 0` disables polling.
 */
export function usePolling(intervalMs: number, onPoll: () => void) {
  const cb = useRef(onPoll);
  useEffect(() => {
    cb.current = onPoll;
  }, [onPoll]);

  useEffect(() => {
    if (intervalMs <= 0) return;
    let last = Date.now();
    let timer: ReturnType<typeof setInterval> | null = null;
    const fire = () => {
      last = Date.now();
      cb.current();
    };
    const start = () => {
      if (timer === null) timer = setInterval(fire, intervalMs);
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stop();
      } else {
        if (Date.now() - last >= intervalMs) fire();
        start();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs]);
}
