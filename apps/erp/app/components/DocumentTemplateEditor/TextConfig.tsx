// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { DocumentBlock, TextEntry } from "@carbon/documents/template";
import {
  getMergeFields,
  getTextEntries,
  isHideable
} from "@carbon/documents/template";
import { cn, IconButton, Input } from "@carbon/react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  LuChevronDown,
  LuEye,
  LuEyeOff,
  LuMousePointerClick
} from "react-icons/lu";
import { useDocumentTemplate, useEditorStore } from "./context";
import { MergeFieldMenu } from "./MergeFieldMenu";
import { PanelSection, useSectionOpen } from "./PanelSection";
import { WordInput, type WordInputHandle } from "./WordInput";

/** The user's changes to a set of texts: a block's, or the template's own. */
type StoredText = { text?: Record<string, string>; hidden?: string[] };

/** A list long enough to need a search box. */
const SEARCH_FROM = 7;
/** How long a text the preview pointed at stays highlighted. */
const FLASH_MS = 1000;

/**
 * Every printed text of a block, from the document's text catalog, under
 * "Words on the page".
 */
export function TextConfig({ block }: { block: DocumentBlock }) {
  const { documentType, updateBlock } = useDocumentTemplate();
  const entries = getTextEntries(documentType, block.type);
  if (entries.length === 0) return null;

  return (
    <WordsSection
      scope={block.id}
      entries={entries}
      stored={block}
      onChange={(next) => updateBlock(block.id, next)}
    />
  );
}

/**
 * The document's own texts (title, footer words, tables outside any block),
 * stored in `settings.text`. `only` and `except` pick which keys this panel shows.
 */
export function DocumentTextConfig({
  only,
  except
}: {
  only?: string[];
  except?: string[];
}) {
  const { documentType, settings, setSetting } = useDocumentTemplate();
  const entries = getTextEntries(documentType, "document").filter(
    (entry) =>
      (!only || only.includes(entry.key)) && !(except ?? []).includes(entry.key)
  );
  if (entries.length === 0) return null;

  // The header and footer panels each show part of `settings.text`: this panel
  // reads and replaces only its own keys, so it never drops the other panel's.
  const keys = new Set(entries.map((entry) => entry.key));
  const own = <T,>(record: Record<string, T> | undefined) =>
    Object.fromEntries(
      Object.entries(record ?? {}).filter(([key]) => keys.has(key))
    );
  const others = <T,>(record: Record<string, T> | undefined) =>
    Object.fromEntries(
      Object.entries(record ?? {}).filter(([key]) => !keys.has(key))
    );
  const orUndefined = <T,>(record: Record<string, T>) =>
    Object.keys(record).length > 0 ? record : undefined;
  const otherHidden = (settings.hidden ?? []).filter((key) => !keys.has(key));

  return (
    <WordsSection
      scope="document"
      entries={entries}
      stored={{
        text: orUndefined(own(settings.text)),
        hidden: (settings.hidden ?? []).filter((key) => keys.has(key))
      }}
      onChange={(next) => {
        const hidden = [...otherHidden, ...(next.hidden ?? [])];
        setSetting(
          "text",
          orUndefined({ ...others(settings.text), ...next.text })
        );
        setSetting("hidden", hidden.length > 0 ? hidden : undefined);
      }}
    />
  );
}

/**
 * The texts of a block in the boxes they print in: a heading starts a group
 * named by what it prints ("Supplier", "Order Info"); texts before the first
 * heading stand on their own.
 */
function groupByHeading(entries: readonly TextEntry[], stored: StoredText) {
  const groups: { id: string; title: string | null; entries: TextEntry[] }[] =
    [];
  for (const entry of entries) {
    if (entry.kind === "heading" || groups.length === 0) {
      const title =
        entry.kind === "heading"
          ? stored.text?.[entry.key] || entry.default
          : null;
      groups.push({ id: entry.key, title, entries: [] });
    }
    groups[groups.length - 1].entries.push(entry);
  }
  return groups;
}

function WordsSection({
  scope,
  entries,
  stored,
  onChange
}: {
  /** The block id, or "document": what a preview click names. */
  scope: string;
  entries: readonly TextEntry[];
  stored: StoredText;
  onChange: (next: StoredText) => void;
}) {
  const { t } = useLingui();
  const { documentType } = useDocumentTemplate();
  const textErrors = useEditorStore((s) => s.textErrors);
  const textFocus = useEditorStore((s) => s.textFocus);
  const [open, setOpen] = useSectionOpen("words", true);
  const [query, setQuery] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLDivElement>());
  const inputs = useRef(new Map<string, WordInputHandle>());
  const hidden = stored.hidden ?? [];

  const labels = useMemo(
    () =>
      Object.fromEntries(
        getMergeFields(documentType).map((f) => [f.token, f.label])
      ),
    [documentType]
  );

  const sectionLabel: Record<NonNullable<TextEntry["section"]>, string> = {
    supplier: t`Supplier`,
    company: t`Your company`,
    buyer: t`Buyer`,
    column: t`Column`,
    lineDetail: t`Line detail`,
    rental: t`Rental`
  };

  const groups = groupByHeading(entries, stored);
  const target = textFocus?.scope === scope ? textFocus : null;
  const targetGroup = target
    ? groups.find((g) => g.entries.some((e) => e.key === target.key))?.id
    : undefined;

  // A click in the preview, in two steps: open the section and the text's
  // group, then, once its row is on screen, scroll to it, flash it and put
  // the caret in it.
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per click (`nonce`), not on every edit.
  useEffect(() => {
    if (!target || !targetGroup) return;
    setOpen(true);
    setQuery("");
    setOpenGroups((s) => ({ ...s, [targetGroup]: true }));
    setPendingKey(target.key);
  }, [target?.nonce]);

  useEffect(() => {
    const row = pendingKey ? rows.current.get(pendingKey) : undefined;
    if (!pendingKey || !row) return;
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    inputs.current.get(pendingKey)?.focus();
    setFlashKey(pendingKey);
    setPendingKey(null);
  });

  useEffect(() => {
    if (!flashKey) return;
    const timer = setTimeout(() => setFlashKey(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flashKey]);

  const setText = (key: string, value: string) => {
    const text = { ...stored.text, [key]: value };
    onChange({ text, hidden: stored.hidden });
  };

  const setShown = (key: string, shown: boolean) => {
    const next = shown
      ? hidden.filter((k) => k !== key)
      : [...hidden.filter((k) => k !== key), key];
    onChange({ text: stored.text, hidden: next.length > 0 ? next : undefined });
  };

  const search = query.trim().toLowerCase();
  const matches = (entry: TextEntry) =>
    !search ||
    entry.default.toLowerCase().includes(search) ||
    (stored.text?.[entry.key] ?? "").toLowerCase().includes(search);

  const renderRow = (entry: TextEntry, siblings: TextEntry[]) => {
    const shown = !hidden.includes(entry.key);
    // Two texts in one box that print the same ("Description" for items and
    // for rentals) are told apart by their section.
    const ambiguous =
      entry.section &&
      siblings.some((s) => s !== entry && s.default === entry.default);
    const error = textErrors[`${scope}:${entry.key}`];
    return (
      <div
        key={entry.key}
        ref={(el) => {
          if (el) rows.current.set(entry.key, el);
          else rows.current.delete(entry.key);
        }}
        className={cn(
          "-mx-1.5 flex flex-col gap-1 rounded-md px-1.5 py-1.5 transition-colors duration-500",
          flashKey === entry.key && "bg-yellow-100 dark:bg-yellow-500/20"
        )}
      >
        <div className="flex items-center gap-1">
          {/* One width for the eye column, so every field starts in line. */}
          <span className="flex size-8 shrink-0 items-center justify-center">
            {isHideable(entry) && (
              <IconButton
                aria-label={shown ? t`Hide from the page` : t`Show on the page`}
                aria-pressed={!shown}
                variant="ghost"
                size="sm"
                icon={shown ? <LuEye /> : <LuEyeOff />}
                onClick={() => setShown(entry.key, !shown)}
              />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <WordInput
              id={`text-${scope}-${entry.key}`}
              value={stored.text?.[entry.key] ?? entry.default}
              labels={labels}
              disabled={!shown}
              invalid={Boolean(error)}
              ariaLabel={entry.default}
              onChange={(value) => setText(entry.key, value)}
              handleRef={(handle) => {
                if (handle) inputs.current.set(entry.key, handle);
                else inputs.current.delete(entry.key);
              }}
            />
          </div>
          {/* Kept in place while hidden so every field is the same width. */}
          <span className={cn("shrink-0", !shown && "invisible")}>
            <MergeFieldMenu
              label=""
              onInsert={(snippet) =>
                inputs.current.get(entry.key)?.insert(snippet)
              }
            />
          </span>
        </div>
        {(!shown || ambiguous || error) && (
          <div className="flex flex-col gap-0.5 pl-9 text-xs">
            {!shown && (
              <span className="text-muted-foreground">
                <Trans>Hidden. It won't print.</Trans>
              </span>
            )}
            {ambiguous && entry.section && (
              <span className="text-muted-foreground">
                {sectionLabel[entry.section]}
              </span>
            )}
            {error && <span className="text-destructive">{error}</span>}
          </div>
        )}
      </div>
    );
  };

  const visibleGroups = groups
    .map((group) => ({ ...group, entries: group.entries.filter(matches) }))
    .filter((group) => group.entries.length > 0);

  return (
    <PanelSection
      title={<Trans>Words on the page</Trans>}
      open={open}
      onOpenChange={setOpen}
      className="-mx-3 border-t"
    >
      <div className="flex flex-col gap-2">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <LuMousePointerClick className="size-3.5 shrink-0" />
          <Trans>Click a word on the page to jump to it here.</Trans>
        </p>
        {entries.length >= SEARCH_FROM && (
          <Input
            size="sm"
            value={query}
            placeholder={t`Find a word…`}
            aria-label={t`Find a word`}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        {visibleGroups.length === 0 && (
          <p className="py-3 text-center text-sm text-muted-foreground">
            <Trans>No words match.</Trans>
          </p>
        )}
        {visibleGroups.map((group, index) => {
          const all = groups.find((g) => g.id === group.id)?.entries ?? [];
          if (group.title === null) {
            return (
              <div key={group.id} className="flex flex-col">
                {group.entries.map((entry) => renderRow(entry, all))}
              </div>
            );
          }
          const isOpen =
            Boolean(search) ||
            (openGroups[group.id] ??
              (index === 0 || visibleGroups.length === 1));
          const hiddenCount = all.filter((e) => hidden.includes(e.key)).length;
          return (
            <div key={group.id} className="rounded-lg border">
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() =>
                  setOpenGroups((s) => ({ ...s, [group.id]: !isOpen }))
                }
                className="flex min-h-10 w-full items-center gap-1.5 rounded-lg px-2.5 py-2 text-left text-sm"
              >
                <LuChevronDown
                  className={cn(
                    "size-4 shrink-0 text-muted-foreground transition-transform duration-150",
                    !isOpen && "-rotate-90"
                  )}
                />
                <span className="truncate font-medium">{group.title}</span>
                <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">
                  <Plural value={all.length} one="# word" other="# words" />
                  {hiddenCount > 0 && (
                    <>
                      {" · "}
                      <Trans>{hiddenCount} hidden</Trans>
                    </>
                  )}
                </span>
              </button>
              {isOpen && (
                <div className="flex flex-col px-2.5 pb-2">
                  {group.entries.map((entry) => renderRow(entry, all))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </PanelSection>
  );
}
