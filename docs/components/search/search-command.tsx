"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useDocsSearch } from "fumadocs-core/search/client";
import { fetchClient } from "fumadocs-core/search/client/fetch";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* Site-wide ⌘K search. Headless fumadocs `useDocsSearch` over the single /api/search
 * endpoint; the surface pills set the Orama `tag` filter. Everything visual here is the
 * warm-paper design — fumadocs-ui's dialog is intentionally not used. */

// Don't query orama below this — a single letter just substring-matches everything.
const MIN_QUERY = 3;
// Strip markdown emphasis/code markers from snippet text. Underscores stay: tool names use them.
const clean = (s: string) => s.replace(/[*`]/g, "");

// Keep the palette scannable. Fumadocs has no server-side limit, so cap here: results come
// back grouped by page (a page row then its heading/text rows), so keep the first N groups
// and a few rows each.
const MAX_PAGES = 8;
const MAX_ROWS_PER_PAGE = 4;
function capResults<T extends { url: string }>(rows: T[]): T[] {
  const out: T[] = [];
  const perPage = new Map<string, number>();
  for (const r of rows) {
    const base = r.url.split("#")[0];
    let n = perPage.get(base);
    if (n === undefined) {
      if (perPage.size >= MAX_PAGES) continue;
      n = 0;
      perPage.set(base, 0);
    }
    if (n >= MAX_ROWS_PER_PAGE) continue;
    perPage.set(base, n + 1);
    out.push(r);
  }
  return out;
}

const SURFACES = [
  { key: "all", label: "All", tag: undefined },
  { key: "guide", label: "Guide", tag: "guide" },
  { key: "docs", label: "Reference", tag: "docs" },
  { key: "resources", label: "API", tag: "resources" },
  { key: "tools", label: "MCP", tag: "tools" },
] as const;

const surfaceToneClasses: Record<string, string> = {
  guide: "border-ed-blue-border bg-ed-blue-bg text-ed-blue-mid",
  api: "border-ed-green-border bg-ed-green-bg text-ed-green-text",
  mcp: "border-ed-amber-stroke bg-ed-amber-fill text-ed-amber-text",
  docs: "border-ed-warm-400 bg-ed-warm-150 text-ed-ink/60",
};

// Which surface a result belongs to is read back off its URL — the flat result list
// from fetchClient doesn't echo the index `tag`.
function surfaceOf(url: string): { label: string; key: string } {
  if (url.startsWith("/guides")) return { label: "Guide", key: "guide" };
  if (url.startsWith("/api-reference")) return { label: "API", key: "api" };
  if (url.startsWith("/mcp")) return { label: "MCP", key: "mcp" };
  return { label: "Reference", key: "docs" };
}

function SearchGlyph({ className }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
      <path d="m20 20-3.2-3.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function SearchCommand() {
  const [open, setOpen] = useState(false);
  const [tag, setTag] = useState<string | undefined>(undefined);
  const [active, setActive] = useState(0);
  const [modKey, setModKey] = useState("⌘");
  const router = useRouter();
  const listRef = useRef<HTMLDivElement>(null);

  // Recreated only when the surface filter changes; `customDeps` re-queries on tag switch.
  const client = useMemo(() => fetchClient({ api: "/api/search", tag }), [tag]);
  const { setSearch, query } = useDocsSearch({ client, delayMs: 80 }, [tag]);

  // Local input value; the orama query only fires at >= MIN_QUERY chars.
  const [value, setValue] = useState("");
  const onChange = useCallback(
    (v: string) => {
      setValue(v);
      setSearch(v.trim().length >= MIN_QUERY ? v.trim() : "");
    },
    [setSearch],
  );

  const results = capResults(query.data && query.data !== "empty" ? query.data : []);
  const ready = value.trim().length >= MIN_QUERY;

  // ⌘K / Ctrl+K toggles the palette from anywhere.
  useEffect(() => {
    if (navigator.platform && !/mac/i.test(navigator.platform)) setModKey("Ctrl ");
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Keep the highlighted row in range and scrolled into view as results change.
  useEffect(() => {
    setActive(0);
  }, [results.length, tag]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const go = useCallback(
    (url: string) => {
      setOpen(false);
      router.push(url);
    },
    [router],
  );

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      go(results[active].url);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label="Search docs"
          className="group inline-flex h-[38px] items-center gap-2 rounded-lg border border-ed-ink/10 bg-ed-warm-100 pl-2.5 pr-2 text-ink-faint shadow-[0_1px_2px_0_rgba(0,0,0,0.04)] transition-colors hover:text-ink-ui sm:w-65 sm:justify-between"
        >
          <span className="flex items-center gap-2">
            <SearchGlyph />
            <span className="hidden text-ed-14 font-book tracking-[0.15px] sm:inline">Search</span>
          </span>
          <kbd className="hidden items-center rounded-[5px] border border-ed-warm-300 bg-ed-paper px-[5px] py-px font-mono text-ed-11 leading-4 text-ed-ink/50 sm:inline-flex">
            {modKey}K
          </kbd>
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-ed-ink/32 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          onOpenAutoFocus={(e) => {
            // Focus the input, not Radix's default first-focusable.
            e.preventDefault();
            (e.currentTarget as HTMLElement).querySelector<HTMLInputElement>("input")?.focus();
          }}
          className="fixed left-1/2 top-[11vh] z-[101] flex max-h-[72vh] w-[calc(100vw-32px)] max-w-150 -translate-x-1/2 flex-col overflow-hidden rounded-[14px] border border-ed-warm-300 bg-ed-paper shadow-[0_24px_60px_-12px_rgba(38,35,35,0.28)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          <Dialog.Title className="sr-only">Search Carbon docs</Dialog.Title>
          <Dialog.Description className="sr-only">
            Search the guide, reference, API resources, and MCP tools.
          </Dialog.Description>

          {/* Search field */}
          <div className="flex h-14 shrink-0 items-center gap-3 border-b border-ed-warm-150 px-[18px]">
            <SearchGlyph className="shrink-0 text-ed-ink/40" />
            <input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={onInputKey}
              placeholder="Search docs, API resources, MCP tools…"
              className="h-full flex-1 border-0 bg-transparent text-ed-16 leading-normal text-ink outline-none placeholder:text-ed-ink/42"
              spellCheck={false}
              autoComplete="off"
            />
            <kbd className="shrink-0 rounded-[5px] border border-ed-warm-300 bg-ed-warm-100 px-1.5 py-0.5 font-mono text-ed-11 text-ed-ink/50">
              esc
            </kbd>
          </div>

          {/* Surface filter pills */}
          <div className="flex shrink-0 items-center gap-1.5 border-b border-ed-warm-150 px-3.5 py-[9px]">
            {SURFACES.map((s) => {
              const on = tag === s.tag;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setTag(s.tag)}
                  className={`rounded-full px-[11px] py-1 text-ed-12 font-book leading-4 transition-colors ${
                    on
                      ? "bg-ed-ink text-ed-warm-100"
                      : "text-ink-faint hover:bg-ed-hairline/70 hover:text-ink-ui"
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>

          {/* Results */}
          <div ref={listRef} className="scrollbar-hidden-until-scroll min-h-30 flex-1 overflow-y-auto p-2">
            {!ready ? (
              <Hint />
            ) : query.isLoading && results.length === 0 ? (
              <Status>Searching…</Status>
            ) : results.length === 0 ? (
              <Status>
                No results for <span className="text-ink">“{value.trim()}”</span>
              </Status>
            ) : (
              results.map((r, i) => (
                <ResultRow
                  key={r.id}
                  result={r}
                  index={i}
                  active={i === active}
                  onHover={() => setActive(i)}
                  onClick={() => go(r.url)}
                />
              ))
            )}
          </div>

          {/* Footer */}
          <div className="flex h-10 shrink-0 items-center gap-4 border-t border-ed-warm-150 px-4 text-ed-12 text-ed-ink/50">
            <FooterKey k="↑↓" label="navigate" />
            <FooterKey k="↵" label="open" />
            <FooterKey k="esc" label="close" />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

type Result = { id: string; url: string; type: "page" | "heading" | "text"; content: string };

function ResultRow({
  result,
  index,
  active,
  onHover,
  onClick,
}: {
  result: Result;
  index: number;
  active: boolean;
  onHover: () => void;
  onClick: () => void;
}) {
  const isPage = result.type === "page";
  const surface = surfaceOf(result.url);
  return (
    <button
      type="button"
      data-row={index}
      onMouseMove={onHover}
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg px-3 text-left transition-colors ${
        isPage ? "mt-1.5 py-2.5 first:mt-0" : "py-[7px] pl-[34px]"
      } ${active ? "bg-ed-hairline/75" : ""}`}
    >
      {!isPage && (
        <span className="shrink-0 text-ed-ink/32" aria-hidden>
          ↳
        </span>
      )}
      <span
        className={`min-w-0 flex-1 truncate ${
          isPage
            ? "text-ed-14 font-demi text-ink"
            : result.type === "heading"
              ? "text-ed-13 font-book text-ed-ink/82"
              : "text-ed-13 font-book text-ed-ink/62"
        }`}
      >
        <Highlighted content={result.content} />
      </span>
      {isPage && (
        <span
          className={`shrink-0 rounded-full border px-[7px] py-0.5 font-mono text-ed-10 leading-3 ${surfaceToneClasses[surface.key]}`}
        >
          {surface.label}
        </span>
      )}
    </button>
  );
}

function Highlighted({ content }: { content: string }) {
  // fumadocs wraps matched substrings in literal <mark> tags inside the result string.
  // Split on the tags and style the marked parts — rendered as escaped text, never raw HTML.
  const parts = content.split(/(<mark>|<\/mark>)/g);
  let marked = false;
  return (
    <>
      {parts.map((part, i) => {
        if (part === "<mark>") {
          marked = true;
          return null;
        }
        if (part === "</mark>") {
          marked = false;
          return null;
        }
        const text = clean(part);
        if (!text) return null;
        return marked ? (
          <mark key={i} className="bg-transparent font-semibold text-ed-brown">
            {text}
          </mark>
        ) : (
          <span key={i}>{text}</span>
        );
      })}
    </>
  );
}

function Hint() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <SearchGlyph className="text-ed-ink/28" />
      <p className="m-0 text-ed-14 leading-normal text-ed-ink/55">
        Search the guide, reference, API resources, and MCP tools.
      </p>
    </div>
  );
}

function Status({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 py-9 text-center text-ed-14 leading-normal text-ed-ink/55">
      {children}
    </div>
  );
}

function FooterKey({ k, label }: { k: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <kbd className="inline-flex items-center rounded-[5px] border border-ed-warm-300 bg-ed-warm-100 px-[5px] py-px font-mono text-ed-11 leading-3.5">
        {k}
      </kbd>
      {label}
    </span>
  );
}
