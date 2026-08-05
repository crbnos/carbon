import { cn } from "@carbon/react";
import {
  VariableText,
  type VariableTextPart
} from "@carbon/react/VariableText";
import type { ValueOrRef, ValueType } from "@carbon/workflows";
import { useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useRef } from "react";
import { useBuilderStoreApi } from "../context";
import { InlineVariableMenu } from "./InlineVariableMenu";
import { publishVariableMenuData, retractVariableMenuData } from "./menuBridge";
import { leafOfLabel } from "./tokenId";
import type { FieldContext } from "./types";
import { useVariableMenuData } from "./useVariableMenuData";
import {
  fromEditorParts,
  toEditorParts,
  withoutTrailingSpace
} from "./valueParts";

/** Typing this opens the variable menu. The closing brace is drawn by the chip. */
const TRIGGER = "{";

type Props = {
  /** Restricts the menu. Omit to offer every variable. */
  accepts?: ValueType;
  /** The value is written into a sentence, so a whole record is not offered — only
   * the properties inside it, which are what reads as text. */
  textOnly?: boolean;
  /** Store a lone variable as a bare reference rather than a one-token template.
   * Not inferred from `accepts`: a clause's left side offers every type and still
   * needs the bare ref, or its operators fall back to the template's string. */
  collapseSingleRef: boolean;
  value: ValueOrRef | undefined;
  onChange: (next: ValueOrRef | undefined) => void;
  context: FieldContext;
  /** Short wording for narrow columns; the full sentence does not fit a clause cell. */
  placeholder?: string;
  hasIssue?: boolean;
  /** Which variables in this value are broken, keyed by position. Those tokens go red. */
  partIssues?: Record<number, string>;
  /** Rows tall before the field scrolls. Prose fields want more than the default. */
  maxRows?: number;
  /** Rows tall when empty, so a field meant for a payload looks like one. */
  minRows?: number;
  /** Let Enter start a new line. A one-line field keeps swallowing it. */
  multiline?: boolean;
  /** Fires as focus enters and leaves. Lets the field hold back advice about a value
   * the user is still in the middle of typing. */
  onFocusChange?: (focused: boolean) => void;
};

export function InlineValueEditor({
  accepts,
  textOnly,
  collapseSingleRef,
  value,
  onChange,
  context,
  placeholder,
  hasIssue,
  partIssues,
  maxRows,
  minRows,
  multiline,
  onFocusChange
}: Props) {
  const { t } = useLingui();
  const store = useBuilderStoreApi();
  const getMenuData = useVariableMenuData(context, accepts, textOnly);

  // Read without subscribing: `nodes` is replaced on every drag frame. Names are
  // display-only here, so a rename elsewhere lands on the next render.
  const nodeName = useCallback(
    (id: string) => store.getState().nodes.find((n) => n.id === id)?.name,
    [store]
  );

  // The bridge is keyed on this function, so its identity must never change: publishing
  // happens on focus alone, and a re-render that swapped it would retract the slot
  // mid-edit and leave the next menu empty. Read the live getter through a ref instead.
  const menuDataRef = useRef(getMenuData);
  menuDataRef.current = getMenuData;
  const getData = useCallback(() => menuDataRef.current(), []);

  // Hand the bridge over on focus, never on mount: every field on the card mounts an
  // editor, and the last one to mount would otherwise own the slot for all of them.
  useEffect(() => () => retractVariableMenuData(getData), [getData]);

  // The plugin still needs a non-empty list to open the popup at all; the menu does its
  // own searching, so this stays unfiltered.
  const items = useCallback(() => getData().flat, [getData]);

  return (
    // `focusin` bubbles, so this fires for the contenteditable inside — before any
    // keystroke can open the menu.
    <div
      className="min-w-0 flex-1"
      onFocusCapture={() => {
        publishVariableMenuData(getData);
        onFocusChange?.(true);
      }}
      onBlurCapture={() => {
        onFocusChange?.(false);
        const parts = toEditorParts(value, nodeName);
        const trimmed = withoutTrailingSpace(parts);
        // Same array back means nothing to trim; writing anyway dirties the workflow
        // on every focus change.
        if (trimmed !== parts) {
          onChange(fromEditorParts(trimmed, { collapseSingleRef }));
        }
      }}
    >
      <VariableText
        value={toEditorParts(value, nodeName, partIssues)}
        onChange={(next: VariableTextPart[]) =>
          onChange(fromEditorParts(next, { collapseSingleRef }))
        }
        placeholder={placeholder ?? t`Type ${TRIGGER} to insert a variable`}
        multiline={multiline === true}
        suggestionChar={TRIGGER}
        suggestionItems={items}
        menuComponent={InlineVariableMenu}
        renderTokenLabel={leafOfLabel}
        maxRows={maxRows}
        minRows={minRows}
        className={cn("w-full", hasIssue && "border-destructive")}
      />
    </div>
  );
}
