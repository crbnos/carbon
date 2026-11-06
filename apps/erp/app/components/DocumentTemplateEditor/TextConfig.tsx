// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { DocumentBlock, TextEntry } from "@carbon/documents/template";
import {
  allMergeFields,
  getTextEntries,
  isHideable
} from "@carbon/documents/template";
import {
  cn,
  IconButton,
  Label,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  Switch
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  LuChevronDown,
  LuChevronUp,
  LuMousePointerClick
} from "react-icons/lu";
import { useDocumentTemplate, useEditorStore, useTextErrors } from "./context";
import { MergeFieldMenu } from "./MergeFieldMenu";
import { useMergeFieldName } from "./mergeFieldNames";
import { groupTexts, wordName } from "./previewText";
import { ValueEditor } from "./ValueEditor";
import { valueTargets } from "./valueTargets";
import { WordInput, type WordInputHandle } from "./WordInput";

/** The user's changes to a set of texts: a block's, or the template's own. */
type StoredText = { text?: Record<string, string>; hidden?: string[] };

/**
 * Every printed text of a block, from the document's text catalog, one at a
 * time: picked in the list or by a click on the page.
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

  return (
    <WordsSection
      scope="document"
      entries={entries}
      stored={settings}
      onChange={(next) => {
        setSetting("text", next.text);
        setSetting("hidden", next.hidden);
      }}
    />
  );
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
  const textErrors = useTextErrors();
  const textFocus = useEditorStore((s) => s.textFocus);
  const focusText = useEditorStore((s) => s.focusText);
  const locked = useEditorStore((s) => s.document?.locked ?? false);
  const hidden = stored.hidden ?? [];

  const fieldName = useMergeFieldName();
  const labels = useMemo(
    () =>
      Object.fromEntries(
        allMergeFields(documentType).map((f) => [f.token, fieldName(f.label)])
      ),
    [documentType, fieldName]
  );

  const sectionLabel: Record<NonNullable<TextEntry["section"]>, string> = {
    supplier: t`Supplier`,
    company: t`Your company`,
    buyer: t`Buyer`,
    column: t`Column`,
    lineDetail: t`Line detail`,
    rental: t`Rental`
  };

  const target = textFocus?.scope === scope ? textFocus : null;
  const entry = entries.find((e) => e.key === target?.key) ?? entries[0]!;
  const index = entries.indexOf(entry);
  const groups = groupTexts(entries, labels);

  // Named by what the catalog calls it, never by what the user typed there.
  const nameOf = (e: TextEntry) => {
    const name = wordName(e.default, labels);
    // Two texts that print the same ("Description" for items and for rentals)
    // are told apart by their section.
    const ambiguous =
      e.section && entries.some((s) => s !== e && s.default === e.default);
    return ambiguous && e.section
      ? `${name} · ${sectionLabel[e.section]}`
      : name;
  };
  const isShown = (e: TextEntry) =>
    !hidden.includes(e.key) && !(e.of && hidden.includes(e.of));

  const name = nameOf(entry);
  const title = groups.find((g) => g.entries.includes(entry))?.title;

  return (
    <div className="-mx-3 flex flex-col gap-4 border-t px-3 py-3">
      {entries.length > 1 && (
        <div className="flex items-center gap-1.5">
          <Select
            value={entry.key}
            onValueChange={(key) => focusText(scope, key)}
          >
            <SelectTrigger
              aria-label={t`Text to edit`}
              className="min-w-0 flex-1"
            >
              <SelectValue>
                <span className="block truncate">
                  {title && !name.startsWith(title)
                    ? `${title} · ${name}`
                    : name}
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {groups.map((group) => (
                <SelectGroup key={group.id}>
                  {group.title && <SelectLabel>{group.title}</SelectLabel>}
                  {group.entries.map((e) => (
                    <SelectItem
                      key={e.key}
                      value={e.key}
                      className={cn(
                        textErrors[`${scope}:${e.key}`] && "text-destructive"
                      )}
                    >
                      {nameOf(e)}
                      {!isShown(e) && (
                        <span className="text-muted-foreground">
                          {" · "}
                          <Trans>Hidden</Trans>
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          <IconButton
            aria-label={t`Previous text`}
            variant="secondary"
            className="size-10"
            icon={<LuChevronUp />}
            isDisabled={index === 0}
            onClick={() => focusText(scope, entries[index - 1]!.key)}
          />
          <IconButton
            aria-label={t`Next text`}
            variant="secondary"
            className="size-10"
            icon={<LuChevronDown />}
            isDisabled={index === entries.length - 1}
            onClick={() => focusText(scope, entries[index + 1]!.key)}
          />
        </div>
      )}
      <WordEditor
        key={`${scope}:${entry.key}`}
        scope={scope}
        entry={entry}
        ariaLabel={name}
        labels={labels}
        text={stored.text?.[entry.key] ?? entry.default}
        shown={isShown(entry)}
        isHidden={hidden.includes(entry.key)}
        error={textErrors[`${scope}:${entry.key}`]}
        focusNonce={target?.caret ? target.nonce : undefined}
        onText={(value) =>
          onChange({
            text: { ...stored.text, [entry.key]: value },
            hidden: stored.hidden
          })
        }
        onShown={(shown) => {
          const others = hidden.filter((k) => k !== entry.key);
          const next = shown ? others : [...others, entry.key];
          onChange({
            text: stored.text,
            hidden: next.length > 0 ? next : undefined
          });
        }}
      />
      {!locked && (
        <p className="flex items-center gap-1.5 border-t pt-3 text-xs text-muted-foreground">
          <LuMousePointerClick className="size-3.5 shrink-0" />
          <Trans>Click anything on the page to edit it.</Trans>
        </p>
      )}
    </div>
  );
}

/** The one text the panel shows. Keyed by the text, so nothing carries over. */
function WordEditor({
  scope,
  entry,
  ariaLabel,
  labels,
  text,
  shown,
  isHidden,
  error,
  focusNonce,
  onText,
  onShown
}: {
  scope: string;
  entry: TextEntry;
  ariaLabel: string;
  labels: Record<string, string>;
  text: string;
  shown: boolean;
  /** Hidden itself, rather than with the column it belongs to. */
  isHidden: boolean;
  error?: string;
  /** Changes when something asks for the caret in this text. */
  focusNonce?: number;
  onText: (value: string) => void;
  onShown: (shown: boolean) => void;
}) {
  const { t } = useLingui();
  const { documentType, blocks, settings } = useDocumentTemplate();
  const locked = useEditorStore((s) => s.document?.locked ?? false);
  const input = useRef<WordInputHandle>(null);

  useEffect(() => {
    if (focusNonce === undefined) return;
    // On a phone this pane is still hidden until the click's own render ends.
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [focusNonce]);

  // A template's preview has values for its clicks; only a document changes them.
  const documentValues = useEditorStore((s) =>
    s.document ? s.documentValues : null
  );
  const [editing, setEditing] = useState<{
    token: string;
    chip: HTMLElement;
  } | null>(null);
  const valuesHere = useMemo(
    () =>
      documentValues
        ? valueTargets(documentType, blocks, settings, documentValues).filter(
            (target) => target.scope === scope
          )
        : [],
    [documentValues, documentType, blocks, settings, scope]
  );
  const editableTokens = useMemo(
    () => new Set(valuesHere.map((target) => target.token)),
    [valuesHere]
  );

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label asChild>
          <span>
            <Trans>Prints as</Trans>
          </span>
        </Label>
        <WordInput
          className="min-h-24"
          value={text}
          labels={labels}
          disabled={!shown || locked}
          struck={!shown}
          invalid={Boolean(error)}
          ariaLabel={ariaLabel}
          onChange={onText}
          editableTokens={locked ? undefined : editableTokens}
          editLabel={t`Edit value`}
          onEditToken={(token, chip) => setEditing({ token, chip })}
          handleRef={input}
        />
        {!shown && (
          <span className="text-xs text-muted-foreground">
            <Trans>Hidden. It won't print.</Trans>
          </span>
        )}
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
      <div className="flex items-center justify-between gap-2">
        {shown && !locked ? (
          <MergeFieldMenu
            label={t`Insert value`}
            variant="secondary"
            row={entry.row}
            onInsert={(snippet) => input.current?.insert(snippet)}
          />
        ) : (
          <span />
        )}
        {isHideable(entry) && (
          <label className="flex items-center gap-2 text-sm">
            <Trans>Show</Trans>
            <Switch
              variant="small"
              checked={shown}
              // A value goes with its column: only the column can bring it back.
              disabled={locked || (!shown && !isHidden)}
              onCheckedChange={onShown}
            />
          </label>
        )}
      </div>
      {editing && (
        <ValueEditor
          token={editing.token}
          chip={editing.chip}
          targets={valuesHere.filter((v) => v.token === editing.token)}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
