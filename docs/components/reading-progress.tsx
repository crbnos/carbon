/**
 * ReadingProgress — the right-rail tick ruler shared by the Guide and the
 * Reference/API/MCP docs. A dense column of dashes that fills brand-color from the top
 * down to the current scroll depth, making the page's length finite and visible.
 * Non-interactive; hidden below xl.
 *
 * CSS-only: the brand overlay's height is driven by `animation-timeline: scroll()`
 * (see `.reading-progress-fill` in global.css) — no JS, no motion library, no
 * per-frame React. Browsers without scroll-timeline simply show no fill.
 */
const TICKS = 88;

function Ticks({ className }: { className?: string }) {
  return (
    <div className={`flex h-full w-full flex-col items-end justify-between ${className ?? ""}`}>
      {Array.from({ length: TICKS }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length decorative ruler
        <span key={i} className="h-px w-3.5 rounded-full bg-current" />
      ))}
    </div>
  );
}

/**
 * `top` is the sticky offset — the fixed chrome above the scroll area: 116 on the Guide
 * (64px header + 52px subnav), 88 on Reference/API/MCP (header only). The rail fills the
 * viewport below that, leaving a little breathing room at the bottom.
 */
export function ReadingProgress({ top = 116 }: { top?: number }) {
  const railHeight = `calc(100dvh - ${top + 48}px)`;
  return (
    <div aria-hidden className="pointer-events-none sticky w-full" style={{ top, height: railHeight }}>
      <div className="relative h-full">
        {/* Base ruler (unread) */}
        <Ticks className="text-[#D8D9D6]" />
        {/* Brand overlay clipped to scroll depth; inner copy is full-height so ticks align */}
        <div className="reading-progress-fill absolute inset-x-0 top-0 overflow-hidden text-ed-brand">
          <div style={{ height: railHeight }}>
            <Ticks className="text-ed-brand" />
          </div>
        </div>
      </div>
    </div>
  );
}
