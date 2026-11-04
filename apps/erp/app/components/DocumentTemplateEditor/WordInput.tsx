// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn } from "@carbon/react";
import { type Ref, useEffect, useImperativeHandle, useRef } from "react";

const TOKEN = /\{([^{}]+)\}/g;
const CHIP_CLASS =
  "mx-px inline-block rounded bg-primary/10 px-1.5 text-xs leading-5 text-primary";

export interface WordInputHandle {
  focus: () => void;
  /** Put a `{token}` where the caret is (at the end when it is elsewhere). */
  insert: (snippet: string) => void;
}

/**
 * A one-line text field that shows each known `{token}` as a chip with its
 * name ("Currency"), so nobody has to read or type a code. The value it hands
 * back is the plain text with the `{token}`s in it.
 */
export function WordInput({
  id,
  value,
  labels,
  onChange,
  disabled,
  struck,
  invalid,
  ariaLabel,
  handleRef
}: {
  id?: string;
  value: string;
  /** Chip name per token; a token not listed stays as typed text. */
  labels: Record<string, string>;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Crossed out: the text is hidden and will not print. */
  struck?: boolean;
  invalid?: boolean;
  ariaLabel: string;
  handleRef?: Ref<WordInputHandle>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The value this field last sent, so its own edits never re-render the DOM
  // under the caret; any other change (Reset, undo, a new block) does.
  const emitted = useRef<string | null>(null);
  const caret = useRef<Range | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || value === emitted.current) return;
    el.replaceChildren(...render(value, labels));
    emitted.current = value;
  }, [value, labels]);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    const next = read(el);
    emitted.current = next;
    onChange(next);
  };

  const keepCaret = () => {
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (range && ref.current?.contains(range.startContainer)) {
      caret.current = range.cloneRange();
    }
  };

  useImperativeHandle(handleRef, () => ({
    focus: () => ref.current?.focus({ preventScroll: true }),
    insert: (snippet) => {
      const el = ref.current;
      if (!el) return;
      const token = snippet.replace(/^\{|\}$/g, "");
      el.focus({ preventScroll: true });
      let range = caret.current;
      if (!range || !el.contains(range.startContainer)) {
        range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
      }
      const node = labels[token]
        ? chip(token, labels[token])
        : document.createTextNode(snippet);
      range.deleteContents();
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      caret.current = range.cloneRange();
      emit();
    }
  }));

  return (
    <div
      id={id}
      ref={ref}
      role="textbox"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-disabled={disabled}
      aria-invalid={invalid}
      contentEditable={!disabled}
      suppressContentEditableWarning
      spellCheck={false}
      onInput={emit}
      onKeyUp={keepCaret}
      onMouseUp={keepCaret}
      onBlur={keepCaret}
      onKeyDown={(e) => {
        // One line: Enter finishes the edit.
        if (e.key === "Enter") {
          e.preventDefault();
          ref.current?.blur();
        }
      }}
      onPaste={(e) => {
        e.preventDefault();
        const text = e.clipboardData.getData("text/plain").replace(/\s+/g, " ");
        document.execCommand("insertText", false, text);
      }}
      className={cn(
        "min-h-9 w-full min-w-0 overflow-hidden whitespace-nowrap rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring",
        disabled && "cursor-not-allowed bg-muted text-muted-foreground",
        struck && "line-through",
        invalid && "border-destructive"
      )}
    />
  );
}

function chip(token: string, label: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.contentEditable = "false";
  span.dataset.token = token;
  span.className = CHIP_CLASS;
  span.textContent = label;
  return span;
}

function render(value: string, labels: Record<string, string>): Node[] {
  const nodes: Node[] = [];
  let last = 0;
  for (const match of value.matchAll(TOKEN)) {
    const label = labels[match[1]];
    if (!label) continue;
    if (match.index > last) {
      nodes.push(document.createTextNode(value.slice(last, match.index)));
    }
    nodes.push(chip(match[1], label));
    last = match.index + match[0].length;
  }
  if (last < value.length)
    nodes.push(document.createTextNode(value.slice(last)));
  return nodes;
}

function read(el: HTMLElement): string {
  let text = "";
  for (const node of el.childNodes) {
    if (node instanceof HTMLElement && node.dataset.token) {
      text += `{${node.dataset.token}}`;
    } else {
      text += node.textContent ?? "";
    }
  }
  return text.replace(/ /g, " ").replace(/\n/g, " ");
}
