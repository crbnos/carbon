"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

// useLayoutEffect warns during SSR; fall back to useEffect on the server.
const useIsoLayoutEffect = typeof document !== "undefined" ? useLayoutEffect : useEffect;
// ease-out: snappy start, gentle settle — the right curve for enter/exit (animations.dev).
const EASE_OUT = "cubic-bezier(0.25, 0.46, 0.45, 0.94)";

// Animates a nav group open/closed via the Web Animations API (height + opacity).
// Stays mounted through the close animation, then unmounts; never animates on first
// paint (so default-open groups don't slide in on load); honors reduced-motion.
function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(open);
  const prevOpen = useRef(open);
  const current = useRef<Animation | null>(null);

  // Mount immediately on open; unmount is deferred until the close animation finishes.
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return; // closed + unmounted: nothing to animate yet
    // Only animate a real open<->close transition. Equal values mean the initial
    // commit (adopt final state, no slide-in on page load) or a benign mount re-run.
    if (open === prevOpen.current) return;
    prevOpen.current = open;
    current.current?.cancel();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (open) {
      if (reduce) {
        el.style.height = "auto";
        return;
      }
      el.style.overflow = "hidden";
      const anim = el.animate(
        [{ height: "0px", opacity: 0 }, { height: `${el.scrollHeight}px`, opacity: 1 }],
        { duration: 200, easing: EASE_OUT },
      );
      current.current = anim;
      anim.onfinish = () => {
        el.style.height = "auto"; // let nested expansions grow naturally
        el.style.overflow = "visible"; // don't clip focus rings once settled
      };
    } else {
      if (reduce) {
        setMounted(false);
        return;
      }
      el.style.overflow = "hidden";
      const anim = el.animate(
        [{ height: `${el.scrollHeight}px`, opacity: 1 }, { height: "0px", opacity: 0 }],
        // fill:forwards holds the collapsed end state so there's no 1-frame snap back
        // to full height between the animation finishing and React unmounting.
        { duration: 170, easing: EASE_OUT, fill: "forwards" }, // exits ~20% faster than entrances
      );
      current.current = anim;
      anim.onfinish = () => setMounted(false);
    }
  }, [open, mounted]);

  if (!mounted) return null;
  return <div ref={ref}>{children}</div>;
}

export type DocsNavNode = { label: string; url?: string; children?: DocsNavNode[] };

const GS_ACTIVE = "bg-ed-brand/10 font-demi text-ed-brand-ink";
const GS_IDLE = "text-ed-ink/90 hover:bg-ed-hairline/55 hover:text-ed-ink";
const GS_LINK = "block rounded-md px-2 py-1 text-ed-15 leading-[135%] transition-colors";
// Top-level group label (Platform, Product reference, …) vs nested sub-group label
// (the module groups inside Product reference) — one step quieter so the hierarchy reads.
const GROUP_LABEL =
  "font-mono text-ed-13 font-semibold uppercase tracking-[0.06em] text-ed-ink/75";
const SUBGROUP_LABEL =
  "font-mono text-ed-12 font-semibold uppercase tracking-[0.05em] text-ed-ink/68";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 12 12"
      fill="none"
      className={`shrink-0 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
      aria-hidden="true"
    >
      <path d="M4.5 3L7.5 6L4.5 9" stroke="rgba(38,35,35,0.48)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DocsNav({ tree }: { tree: DocsNavNode[] }) {
  const pathname = usePathname();
  // User toggles override the default open/closed; default is open at the top level and
  // for any branch that holds the active page (so deep module groups stay collapsed until
  // you're in them, but the current one is revealed on load).
  const [override, setOverride] = useState<Record<string, boolean>>({});

  const isActive = (url?: string) => !!url && pathname === url;
  const holdsActive = (node: DocsNavNode): boolean =>
    isActive(node.url) || !!node.children?.some(holdsActive);

  const render = (nodes: DocsNavNode[], depth: number, parentKey: string): ReactNode[] =>
    nodes.map((node) => {
      const key = `${parentKey}/${node.label}`;

      if (!node.children?.length) {
        return (
          <Link
            key={key}
            href={node.url ?? "#"}
            className={`${GS_LINK} ${isActive(node.url) ? GS_ACTIVE : GS_IDLE}`}
          >
            {node.label}
          </Link>
        );
      }

      const open = override[key] ?? (depth === 0 || holdsActive(node));
      return (
        <div key={key} className={depth === 0 ? "mt-2 first:mt-0.5" : "mt-1 first:mt-0"}>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOverride((p) => ({ ...p, [key]: !open }))}
            className="flex w-full items-center gap-[7px] rounded-[7px] px-2 py-[5px] transition-colors hover:bg-ed-hairline/50"
          >
            <Chevron open={open} />
            <span className={depth === 0 ? GROUP_LABEL : SUBGROUP_LABEL}>{node.label}</span>
          </button>

          <Collapse open={open}>
            <div className="mt-0.5 mb-0.5 ml-[13px] flex flex-col gap-0.5 border-l border-ed-warm-150 py-0.5 pl-2">
              {node.url && (
                <Link
                  href={node.url}
                  className={`${GS_LINK} ${isActive(node.url) ? GS_ACTIVE : GS_IDLE}`}
                >
                  Overview
                </Link>
              )}
              {render(node.children, depth + 1, key)}
            </div>
          </Collapse>
        </div>
      );
    });

  return <nav className="flex flex-col gap-0.5">{render(tree, 0, "")}</nav>;
}
