import { cn } from "@carbon/react";
import {
  VariableText,
  type VariableTextPart
} from "@carbon/react/VariableText";
import type { ValueOrRef, ValueType } from "@carbon/workflows";
import { useLingui } from "@lingui/react/macro";
import { useCallback, useEffect } from "react";
import { useBuilderStoreApi } from "../context";
import { InlineVariableMenu } from "./InlineVariableMenu";
import { publishVariableMenuData, retractVariableMenuData } from "./menuBridge";
import { leafOfLabel } from "./tokenId";
import type { FieldContext } from "./types";
import { useVariableMenuData } from "./useVariableMenuData";
import { fromEditorParts, toEditorParts } from "./valueParts";

/** Typing this opens the variable menu. The closing brace is drawn by the chip. */
const TRIGGER = "{";

type Props = {
  /** Restricts the menu, and marks this as a field that type-checks a bare
   * reference. Omit on template fields, which take any type as text. */
  accepts?: ValueType;
  value: ValueOrRef | undefined;
  onChange: (next: ValueOrRef | undefined) => void;
  context: FieldContext;
  /** Short wording for narrow columns; the full sentence does not fit a clause cell. */
  placeholder?: string;
  hasIssue?: boolean;
  /** Rows tall before the field scrolls. Prose fields want more than the default. */
  maxRows?: number;
};

export function InlineValueEditor({
  accepts,
  value,
  onChange,
  context,
  placeholder,
  hasIssue,
  maxRows
}: Props) {
  const { t } = useLingui();
  const store = useBuilderStoreApi();
  const getMenuData = useVariableMenuData(context, accepts);

  // Read without subscribing: `nodes` is replaced on every drag frame. Names are
  // display-only here, so a rename elsewhere lands on the next render.
  const nodeName = useCallback(
    (id: string) => store.getState().nodes.find((n) => n.id === id)?.name,
    [store]
  );

  // Hand the bridge over on focus, never on mount: every field on the card mounts an
  // editor, and the last one to mount would otherwise own the slot for all of them.
  useEffect(() => () => retractVariableMenuData(getMenuData), [getMenuData]);

  // The plugin still needs a non-empty list to open the popup at all; the menu does its
  // own searching, so this stays unfiltered.
  const items = useCallback(() => getMenuData().flat, [getMenuData]);

  return (
    // `focusin` bubbles, so this fires for the contenteditable inside — before any
    // keystroke can open the menu.
    <div
      className="min-w-0 flex-1"
      onFocusCapture={() => publishVariableMenuData(getMenuData)}
    >
      <VariableText
        value={toEditorParts(value, nodeName)}
        onChange={(next: VariableTextPart[]) =>
          onChange(
            fromEditorParts(next, { collapseSingleRef: accepts !== undefined })
          )
        }
        placeholder={placeholder ?? t`Type ${TRIGGER} to insert a variable`}
        multiline={false}
        suggestionChar={TRIGGER}
        suggestionItems={items}
        menuComponent={InlineVariableMenu}
        renderTokenLabel={leafOfLabel}
        maxRows={maxRows}
        className={cn("w-full", hasIssue && "border-destructive")}
      />
    </div>
  );
}
