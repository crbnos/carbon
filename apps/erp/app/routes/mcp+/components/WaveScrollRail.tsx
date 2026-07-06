import { useEffect, useRef } from "react";

const N = 46;

export function WaveScrollRail() {
  const railRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dashes: HTMLDivElement[] = [];
    for (let i = 0; i < N; i++) {
      const d = document.createElement("div");
      d.className = "dash";
      rail.appendChild(d);
      dashes.push(d);
    }
    let crest = 0;
    let hoverT: number | null = null;
    let scrubbing = false;
    let raf = 0;
    const t0 = performance.now();

    const fracAt = (clientY: number) => {
      const r = rail.getBoundingClientRect();
      return Math.max(0, Math.min(1, (clientY - r.top) / r.height));
    };
    const scrollP = () => {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      return h > 0 ? Math.max(0, Math.min(1, window.scrollY / h)) : 0;
    };
    const scrollToFrac = (t: number, behavior: ScrollBehavior) => {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo({ top: t * h, behavior });
    };

    // Click jumps (smooth); dragging scrubs (instant follow).
    const onDown = (e: PointerEvent) => {
      scrubbing = true;
      rail.setPointerCapture(e.pointerId);
      hoverT = fracAt(e.clientY);
      scrollToFrac(hoverT, "smooth");
    };
    const onMove = (e: PointerEvent) => {
      hoverT = fracAt(e.clientY);
      if (scrubbing) scrollToFrac(hoverT, "auto");
    };
    const onUp = (e: PointerEvent) => {
      scrubbing = false;
      rail.releasePointerCapture?.(e.pointerId);
    };
    const onLeave = () => {
      if (!scrubbing) hoverT = null;
    };
    rail.addEventListener("pointerdown", onDown);
    rail.addEventListener("pointermove", onMove);
    rail.addEventListener("pointerup", onUp);
    rail.addEventListener("pointerleave", onLeave);

    const frame = (now: number) => {
      const time = (now - t0) / 1000;
      const target = hoverT != null ? hoverT : scrollP();
      crest += (target - crest) * 0.12;
      const p = scrollP();
      for (let i = 0; i < N; i++) {
        const tt = i / (N - 1);
        const dd = tt - crest;
        const env = Math.exp(-(dd * dd) * 55);
        const ripple = RM
          ? 0
          : 0.5 + 0.5 * Math.sin(time * 2 - tt * Math.PI * 7);
        const w = 5 + env * 15 + ripple * env * 3 + ripple * 1;
        const d = dashes[i];
        const passed = tt <= p + 0.002;
        d.style.width = `${w.toFixed(1)}px`;
        d.style.background =
          env > 0.5
            ? "var(--acc)"
            : passed
              ? "hsl(var(--foreground))"
              : "hsl(var(--border))";
        d.style.opacity = String((passed ? 0.7 : 0.45) + 0.3 * env);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      rail.removeEventListener("pointerdown", onDown);
      rail.removeEventListener("pointermove", onMove);
      rail.removeEventListener("pointerup", onUp);
      rail.removeEventListener("pointerleave", onLeave);
      for (const d of dashes) d.remove();
    };
  }, []);
  return <div className="waverail" ref={railRef} aria-hidden="true" />;
}
