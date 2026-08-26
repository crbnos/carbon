"use client";

import "./variable-text.css";

import {
  createMentionExtension,
  EditorContent,
  type EditorInstance,
  EditorRoot,
  type JSONContent,
  type MentionListComponent,
  Placeholder,
  StarterKit
} from "@carbon/tiptap";
import type { CSSProperties, RefObject } from "react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef
} from "react";
import { cn } from "../utils/cn";
import { createVariableChip } from "./VariableChip";

export type VariableTextToken = { id: string; label: string };
export type VariableTextPart =
  | { kind: "text"; text: string }
  /** `invalid` draws the token in red — for a reference whose target has gone away. */
  | { kind: "token"; id: string; label: string; invalid?: boolean };

export type VariableTextSuggestion = VariableTextToken & { helper?: string };

export type VariableTextProps = {
  value: VariableTextPart[];
  onChange: (parts: VariableTextPart[]) => void;
  placeholder?: string;
  className?: string;
  multiline?: boolean;
  /** Trigger character for the token menu. Omit to leave the menu disabled. */
  suggestionChar?: string;
  /** Read on every keystroke while the menu is open. */
  suggestionItems?: () => VariableTextSuggestion[];
  /** Where the popup mounts. Keeps it inside a transformed or scrolling panel. */
  popupContainerRef?: RefObject<Element> | null;
  /** Rows tall before the field starts scrolling. */
  maxRows?: number;
  /** Rows tall when empty. */
  minRows?: number;
  /** Renders the token menu instead of the built-in list. */
  menuComponent?: MentionListComponent;
  /** Shortens the text drawn inside a token chip. The stored label is untouched. */
  renderTokenLabel?: (label: string) => string;
  /** Renders the same value but refuses edits. The Tiptap shell stays, so the
   * read-only rendition matches the editable one exactly. */
  isReadOnly?: boolean;
};

export type VariableTextHandle = {
  insertToken: (token: VariableTextToken) => void;
};

// --- helpers ---

/** A newline is a paragraph break in the document and a "\n" in the value, so a
 * multiline field round-trips its line breaks instead of quietly losing them. */
function partsToDoc(parts: VariableTextPart[]): JSONContent {
  const paragraphs: JSONContent[][] = [[]];
  const current = () => paragraphs[paragraphs.length - 1] as JSONContent[];

  for (const part of parts) {
    if (part.kind === "token") {
      current().push({
        type: "variable",
        attrs: {
          id: part.id,
          label: part.label,
          invalid: part.invalid === true
        }
      });
      continue;
    }
    const lines = part.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) paragraphs.push([]);
      const line = lines[i];
      if (line) current().push({ type: "text", text: line });
    }
  }

  return {
    type: "doc",
    content: paragraphs.map((nodes) => ({
      type: "paragraph",
      content: nodes.length ? nodes : undefined
    }))
  };
}

function docToParts(doc: JSONContent): VariableTextPart[] {
  const parts: VariableTextPart[] = [];
  const pushText = (text: string) => {
    const last = parts[parts.length - 1];
    if (last?.kind === "text") last.text += text;
    else parts.push({ kind: "text", text });
  };

  let first = true;
  for (const para of doc.content ?? []) {
    if (!first) pushText("\n");
    first = false;
    for (const node of para.content ?? []) {
      if (node.type === "text" && node.text) {
        pushText(node.text);
      } else if (node.type === "variable" && node.attrs) {
        parts.push({
          kind: "token",
          id: node.attrs.id as string,
          label: node.attrs.label as string,
          invalid: node.attrs.invalid === true
        });
      }
    }
  }
  return parts;
}

/** Content identity for reconciliation. Labels are display, so a renamed token
 * must not count as a content change and reset the caret. Validity does count —
 * it is drawn from an attribute, so the document has to be rewritten to show it. */
function contentKey(parts: VariableTextPart[]): string {
  return JSON.stringify(
    parts
      .filter((p) => p.kind !== "text" || p.text !== "")
      .map((p) =>
        p.kind === "text" ? p.text : `${p.id}${p.invalid ? "!" : ""}`
      )
  );
}

// A char no keyboard produces, so the menu stays dormant when no trigger is given.
const NO_TRIGGER = "\0";

/** The editor shell, exported so a read-only rendition of the same value matches. It is
 * chrome only — the padding and the height floor live on the contenteditable itself
 * (`.variable-text-content`), so that element fills the box and a click anywhere in it
 * places a caret. `select-text` is load-bearing: React Flow puts `user-select: none` on
 * every node, and an inherited `none` stops a click placing the caret at all. */
export const VARIABLE_TEXT_SHELL_CLASS =
  "select-text cursor-text overflow-y-auto overscroll-contain break-words rounded-md border border-input bg-background text-sm";

// A `text-sm` line box plus the content's own padding, so one row is 2.5rem.
const ROW_REM = 1.25;
const PADDING_REM = 1.25;
const heightFor = (rows: number) => `${rows * ROW_REM + PADDING_REM}rem`;

// --- component ---

export const VariableText = forwardRef<VariableTextHandle, VariableTextProps>(
  function VariableText(
    {
      value,
      onChange,
      placeholder,
      className,
      multiline,
      suggestionChar,
      suggestionItems,
      popupContainerRef,
      maxRows = 5,
      minRows = 1,
      menuComponent,
      renderTokenLabel,
      isReadOnly = false
    },
    ref
  ) {
    const editorRef = useRef<EditorInstance | null>(null);

    // Read through refs so a new callback identity never re-creates the extension,
    // which would tear the editor down mid-keystroke.
    const itemsRef = useRef(suggestionItems);
    itemsRef.current = suggestionItems;
    const renderTokenLabelRef = useRef(renderTokenLabel);
    renderTokenLabelRef.current = renderTokenLabel;
    const menuOpen = useRef(false);
    const valueRef = useRef(value);
    valueRef.current = value;

    // biome-ignore lint/correctness/useExhaustiveDependencies: initial content only on mount
    const initialContent = useMemo(() => partsToDoc(value), []);

    const variableExtension = useMemo(
      () =>
        createMentionExtension({
          name: "variable",
          char: suggestionChar ?? NO_TRIGGER,
          items: () => (suggestionChar ? (itemsRef.current?.() ?? []) : []),
          // A custom menu does its own searching and grouping — filtering here would hide
          // rows it wants to show.
          filter: menuComponent
            ? () => true
            : (item, query) =>
                item.label.toLowerCase().includes(query.toLowerCase()),
          // The default is `[" "]`, which ignores the trigger mid-word.
          allowedPrefixes: null,
          elementRef: popupContainerRef,
          listComponent: menuComponent,
          renderLabel: ({ id, label }) => {
            const full = label ?? id ?? "";
            return `{${renderTokenLabelRef.current?.(full) ?? full}}`;
          },
          chipComponent: createVariableChip(
            (label) => renderTokenLabelRef.current?.(label) ?? label
          ),
          onActiveChange: (active) => {
            menuOpen.current = active;
          }
        }),
      [suggestionChar, popupContainerRef, menuComponent]
    );

    const extensions = useMemo(
      () => [
        StarterKit.configure({
          heading: false,
          bulletList: false,
          orderedList: false,
          listItem: false,
          codeBlock: false,
          horizontalRule: false,
          dropcursor: false,
          gapcursor: false,
          // A token field is not rich text; formatting would only survive a paste.
          bold: false,
          italic: false,
          strike: false,
          code: false
        }),
        Placeholder.configure({ placeholder }),
        variableExtension
      ],
      [placeholder, variableExtension]
    );

    // Controlled: adopt a value that changed outside the editor (undo, autosave, a
    // repaired reference). Keyed on content identity, not `value`, so a label-only
    // change never resets the caret mid-typing.
    const key = contentKey(value);
    useEffect(() => {
      const editor = editorRef.current;
      if (!editor) return;
      if (contentKey(docToParts(editor.getJSON())) === key) return;
      editor.commands.setContent(partsToDoc(valueRef.current), false);
    }, [key]);

    // The editor is created once, so a lock that arrives later has to be applied here.
    useEffect(() => {
      editorRef.current?.setEditable(!isReadOnly);
    }, [isReadOnly]);

    useImperativeHandle(ref, () => ({
      insertToken: (token) => {
        const editor = editorRef.current;
        if (!editor) return;
        if (!editor.isFocused) editor.commands.focus("end");
        editor.commands.insertContent({
          type: "variable",
          attrs: { id: token.id, label: token.label }
        });
      }
    }));

    return (
      <EditorRoot>
        {/* The shell is a wrapper, not `EditorContent`'s own div, because `EditorContent`
            forwards unknown props to the editor rather than to the element — it has no
            `style` passthrough, and the row range has to be an inline height. */}
        <div
          className={cn(VARIABLE_TEXT_SHELL_CLASS, className)}
          style={
            {
              minHeight: heightFor(minRows),
              maxHeight: heightFor(maxRows),
              "--variable-text-content-min-height": heightFor(minRows)
            } as CSSProperties
          }
        >
          <EditorContent
            initialContent={initialContent}
            extensions={extensions}
            editable={!isReadOnly}
            editorProps={{
              handleKeyDown(_view, event) {
                // Never swallow the popup's Enter: ProseMirror consults these props
                // before the suggestion plugin gets a look.
                if (menuOpen.current) return false;
                if (multiline === false && event.key === "Enter") return true;
                return false;
              },
              attributes: {
                class: "focus:outline-none max-w-full variable-text-content"
              }
            }}
            onCreate={({ editor }) => {
              editorRef.current = editor;
            }}
            onUpdate={({ editor }) => {
              editorRef.current = editor;
              onChange(docToParts(editor.getJSON()));
            }}
          />
        </div>
      </EditorRoot>
    );
  }
);
