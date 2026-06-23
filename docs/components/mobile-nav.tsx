"use client";

/**
 * The mobile navigation drawer. Below `lg` the section sidebars are hidden and the
 * header's link row collapses, so this is the *only* way to move around on a phone:
 * a hamburger in the header opens a left drawer that carries the site-level nav
 * (Guides · Reference · API · MCP) plus, when a surface passes one, its full section
 * tree. The header stays on top (higher z) so the hamburger morphs to an X and can
 * close what it opened; the scrim and Esc close it too.
 *
 * Section trees are passed as `children`. Reference/API/MCP use `<Link>`, so a route
 * change closes the drawer on its own; the editorial Guide navigates via client state
 * (no route change), so its tree calls `useMobileNavClose()` to dismiss on select.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

const NAV = [
  { key: "guides", label: "Guides", href: "/guides/order" },
  { key: "reference", label: "Reference", href: "/docs" },
  { key: "api", label: "API", href: "/api-reference" },
  { key: "mcp", label: "MCP", href: "/mcp" },
] as const;

type Active = (typeof NAV)[number]["key"];

const CloseCtx = createContext<() => void>(() => {});
/** Lets a client-state nav (the Guide) dismiss the drawer after it switches section. */
export const useMobileNavClose = () => useContext(CloseCtx);

function HamburgerIcon({ open }: { open: boolean }) {
  return (
    <span className="relative block h-[15px] w-[18px]" aria-hidden="true">
      <span
        className={`absolute left-0 h-[1.6px] w-full rounded-full bg-current transition-all duration-300 ease-out ${
          open ? "top-1/2 -translate-y-1/2 rotate-45" : "top-0.5"
        }`}
      />
      <span
        className={`absolute left-0 top-1/2 h-[1.6px] w-full -translate-y-1/2 rounded-full bg-current transition-opacity duration-200 ${
          open ? "opacity-0" : "opacity-100"
        }`}
      />
      <span
        className={`absolute left-0 h-[1.6px] w-full rounded-full bg-current transition-all duration-300 ease-out ${
          open ? "top-1/2 -translate-y-1/2 -rotate-45" : "bottom-0.5"
        }`}
      />
    </span>
  );
}

export function MobileNav({ active, children }: { active?: Active; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  const close = useCallback(() => setOpen(false), []);

  // The overlay is portaled to <body>; only do so after mount (no SSR portal target).
  useEffect(() => setMounted(true), []);

  // A real route change (Reference/API/MCP links) means the drawer's job is done.
  // The Guide never changes route, so it dismisses itself via useMobileNavClose().
  // biome-ignore lint/correctness/useExhaustiveDependencies: close on every navigation
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Let other surfaces (the Guide's mobile context bar) open the drawer without
  // threading state through — they dispatch a window event, we listen.
  useEffect(() => {
    const open = () => setOpen(true);
    window.addEventListener("carbon:open-mobile-nav", open);
    return () => window.removeEventListener("carbon:open-mobile-nav", open);
  }, []);

  // While open: Esc closes, and the body underneath is locked so it can't scroll.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-ed-ink/10 bg-ed-warm-100 text-ink-ui shadow-[0_1px_2px_0_rgba(0,0,0,0.04)] transition-colors hover:bg-ed-hairline/60 lg:hidden"
      >
        <HamburgerIcon open={open} />
      </button>

      {/* Overlay is portaled to <body> so it escapes the header's stacking context.
          The header (z-60) then paints ABOVE the overlay (z-58) and stays fully on top
          and interactive; the scrim only dims the content below the header. */}
      {mounted &&
        createPortal(
          <div
            className={`fixed inset-0 z-[58] lg:hidden ${open ? "" : "pointer-events-none"}`}
            // `inert` when closed: the off-screen panel's links/buttons leave the tab
            // order and the a11y tree (a plain aria-hidden left them focusable).
            inert={!open}
          >
        {/* Scrim */}
        <button
          type="button"
          tabIndex={-1}
          aria-label="Close menu"
          onClick={close}
          className={`absolute inset-0 cursor-default bg-[rgba(20,18,18,0.34)] backdrop-blur-[1px] transition-opacity duration-300 ${
            open ? "opacity-100" : "opacity-0"
          }`}
        />

        {/* Panel — starts under the 64px header and runs to the bottom. */}
        <aside
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
          className={`absolute bottom-0 left-0 top-16 flex w-[min(86vw,340px)] flex-col overflow-y-auto overscroll-contain border-r border-ed-hairline bg-ed-paper shadow-[8px_0_40px_-12px_rgba(38,35,35,0.28)] transition-transform duration-300 ease-out scrollbar-hidden-until-scroll ${
            open ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex flex-1 flex-col px-5 pb-6 pt-[22px]">
            {/* Site-level nav */}
            <p className="mb-2 px-1 font-mono text-ed-11 font-semibold uppercase tracking-[0.08em] text-ed-ink/50">
              Browse
            </p>
            <nav className="flex flex-col gap-0.5">
              {NAV.map((item) => (
                <Link
                  key={item.key}
                  href={item.href}
                  aria-current={active === item.key ? "page" : undefined}
                  className={`rounded-lg px-3 py-2.5 text-ed-16 leading-[140%] tracking-[0.15px] no-underline transition-colors ${
                    active === item.key
                      ? "bg-ed-brand/10 font-demi text-ed-brand-ink"
                      : "font-book text-ink-ui hover:bg-ed-hairline/55"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>

            {/* Section tree for the current surface, if any */}
            {children ? (
              <CloseCtx.Provider value={close}>
                <div className="mt-[22px] border-t border-ed-hairline pt-[22px]">{children}</div>
              </CloseCtx.Provider>
            ) : null}

            {/* CTA pinned to the bottom of the panel */}
            <a
              href="https://app.carbon.ms"
              className="group relative mt-[26px] inline-flex h-11 items-center justify-center rounded-lg no-underline"
            >
              <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-lg cta-btn-dark" />
              <span className="text-on-dark relative z-10 text-ed-15 font-book tracking-[0.15px]">
                Open Carbon
              </span>
            </a>
          </div>
        </aside>
          </div>,
          document.body,
        )}
    </>
  );
}
