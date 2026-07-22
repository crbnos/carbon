/**
 * Mobile navigation drawer. Below `lg` the course sidebar is hidden and the header's
 * link row collapses, so this is the only way to move around on a phone: a hamburger
 * in the header opens a left drawer carrying the site nav (Courses · About) plus the
 * course tree passed as `children`. The scrim and Esc close it; a route change closes
 * it automatically.
 */
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState
} from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router";
import { useOptionalUser } from "~/hooks/useUser";
import { path } from "~/utils/path";

const NAV = [
  { key: "courses", label: "Lessons", href: path.to.root, external: false },
  { key: "docs", label: "Docs", href: path.to.docs, external: true },
  { key: "glossary", label: "Glossary", href: path.to.glossary, external: true }
] as const;

type Active = (typeof NAV)[number]["key"];

const CloseCtx = createContext<() => void>(() => undefined);
/** Lets a nested nav dismiss the drawer after selecting an entry. */
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

export function MobileNav({
  active,
  children
}: {
  active?: Active;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { pathname } = useLocation();
  const user = useOptionalUser();
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => setMounted(true), []);

  // A route change means the drawer's job is done.
  // biome-ignore lint/correctness/useExhaustiveDependencies: close on every navigation
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

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

      {mounted &&
        createPortal(
          <div
            className={`fixed inset-0 z-[58] lg:hidden ${open ? "" : "pointer-events-none"}`}
            // `inert` isn't in React 18's DOM types yet; spread it so the closed
            // panel's controls leave the tab order and a11y tree.
            {...(!open ? ({ inert: "" } as Record<string, string>) : {})}
          >
            <button
              type="button"
              tabIndex={-1}
              aria-label="Close menu"
              onClick={close}
              className={`absolute inset-0 cursor-default bg-[rgba(20,18,18,0.34)] backdrop-blur-[1px] transition-opacity duration-300 ${
                open ? "opacity-100" : "opacity-0"
              }`}
            />

            <aside
              role="dialog"
              aria-modal="true"
              aria-label="Navigation"
              className={`absolute bottom-0 left-0 top-16 flex w-[min(86vw,340px)] flex-col overflow-y-auto overscroll-contain border-r border-ed-hairline bg-ed-paper shadow-[8px_0_40px_-12px_rgba(38,35,35,0.28)] transition-transform duration-300 ease-out scrollbar-hidden-until-scroll ${
                open ? "translate-x-0" : "-translate-x-full"
              }`}
            >
              <div className="flex flex-1 flex-col px-5 pb-6 pt-[22px]">
                <p className="mb-2 px-1 font-mono text-ed-11 font-semibold uppercase tracking-[0.08em] text-ed-ink/50">
                  Browse
                </p>
                <nav className="flex flex-col gap-0.5">
                  {NAV.map((item) => {
                    const cls = `rounded-lg px-3 py-2.5 text-ed-16 leading-[140%] tracking-[0.15px] no-underline transition-colors ${
                      active === item.key
                        ? "bg-ed-brand/10 font-demi text-ed-brand-ink"
                        : "font-book text-ink-ui hover:bg-ed-hairline/55"
                    }`;
                    return item.external ? (
                      <a
                        key={item.key}
                        href={item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cls}
                      >
                        {item.label}
                      </a>
                    ) : (
                      <Link
                        key={item.key}
                        to={item.href}
                        aria-current={active === item.key ? "page" : undefined}
                        className={cls}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </nav>

                {children ? (
                  <CloseCtx.Provider value={close}>
                    <div className="mt-[22px] border-t border-ed-hairline pt-[22px]">
                      {children}
                    </div>
                  </CloseCtx.Provider>
                ) : null}

                {!user ? (
                  <Link
                    to={path.to.login}
                    className="group relative mt-[26px] inline-flex h-11 items-center justify-center rounded-lg no-underline"
                  >
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 rounded-lg cta-btn-dark"
                    />
                    <span className="text-on-dark relative z-10 text-ed-15 font-book tracking-[0.15px]">
                      Login
                    </span>
                  </Link>
                ) : null}
              </div>
            </aside>
          </div>,
          document.body
        )}
    </>
  );
}
