"use client";
// ═══════════════════════════════════════════
// useSmoothSwipe — 横スワイプで月送り
// 指に追従 → 離したらスライドアウト → 新月スライドイン
// ═══════════════════════════════════════════
import { useEffect, useRef, useCallback } from "react";

export function useSmoothSwipe(onSwipe: (dir: 1 | -1) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const state = useRef({ startX: 0, startY: 0, dx: 0, swiping: false });

  const stableOnSwipe = useCallback(onSwipe, [onSwipe]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const ts = (e: TouchEvent) => {
      const t = e.touches[0];
      state.current = { startX: t.clientX, startY: t.clientY, dx: 0, swiping: true };
    };

    const tm = (e: TouchEvent) => {
      if (!state.current.swiping) return;
      const dx = e.touches[0].clientX - state.current.startX;
      const dy = Math.abs(e.touches[0].clientY - state.current.startY);
      if (dy > Math.abs(dx)) { state.current.swiping = false; return; }
      if (Math.abs(dx) > 10) e.preventDefault();
      state.current.dx = dx;
      el.style.transform = `translateX(${dx * 0.4}px)`;
      el.style.transition = "none";
      el.style.willChange = "transform"; // GPU アクセラレーション
    };

    const te = () => {
      const { dx, swiping } = state.current;
      if (!swiping) { el.style.transform = ""; el.style.transition = ""; return; }
      state.current.swiping = false;

      if (Math.abs(dx) > 60) {
        const dir = (dx < 0 ? 1 : -1) as 1 | -1;
        // スライドアウト
        el.style.transform = `translateX(${dir * -100}px)`;
        el.style.transition = "transform 0.2s ease-out";
        el.style.opacity = "0.3";
        setTimeout(() => {
          stableOnSwipe(dir);
          el.style.transition = "none";
          el.style.transform = `translateX(${dir * 80}px)`;
          el.style.opacity = "0.3";
          // スライドイン
          requestAnimationFrame(() => {
            el.style.transition = "transform 0.25s ease-out, opacity 0.25s ease-out";
            el.style.transform = "translateX(0)";
            el.style.opacity = "1";
          });
        }, 200);
      } else {
        // 戻す
        el.style.transition = "transform 0.25s ease-out";
        el.style.transform = "translateX(0)";
      }
    };

    el.addEventListener("touchstart", ts, { passive: true });
    el.addEventListener("touchmove", tm, { passive: false });
    el.addEventListener("touchend", te, { passive: true });
    return () => {
      el.removeEventListener("touchstart", ts);
      el.removeEventListener("touchmove", tm);
      el.removeEventListener("touchend", te);
    };
  }, [stableOnSwipe]);

  return ref;
}
