// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn } from "@carbon/react";
import { type Ref, useEffect, useImperativeHandle, useRef } from "react";

const TOKEN = /\{([^{}]+)\}/g;
const CHIP_CLASS =
  "group/chip relative mx-px inline-block rounded bg-primary/10 px-1.5 text-xs leading-5 text-primary [@media(hover:none)]:has-[button]:pr-6";
/**
 * The pencil of an editable chip: on top of the chip's text while hovered, taking
 * no space, so the chip is the same width with or without it. Chips are plain DOM,
 * not React, inside the editable field.
 */
const CHIP_EDIT_CLASS =
  "absolute inset-y-0 right-0 flex w-5 cursor-pointer items-center justify-center rounded-r text-primary opacity-0 transition-opacity duration-100 focus-visible:opacity-100 group-hover/chip:opacity-100 [@media(hover:none)]:opacity-100";
const CHIP_EDIT_BACKGROUND =
  "linear-gradient(hsl(var(--primary) / 0.14), hsl(var(--primary) / 0.14)), hsl(var(--card))";
const PEN_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/></svg>';

export interface WordInputHandle {
  focus: () => void;
  /** Put a `{token}` where the caret is (at the end when it is elsewhere). */
  insert: (snippet: string) => void;
}

/**
 * A text field that shows each known `{token}` as a chip with its
 * name ("Currency"), so nobody has to read or type a code. The value it hands
 * back is the plain text with the `{token}`s in it.
 */
export function WordInput({
  id,
  className,
  value,
  labels,
  onChange,
  disabled,
  struck,
  invalid,
  ariaLabel,
  handleRef,
  editableTokens,
  editLabel,
  onEditToken
}: {
  id?: string;
  className?: string;
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
  /** Chips that show a pencil, because this document can change their value. */
  editableTokens?: ReadonlySet<string>;
  /** What the pencil says to a screen reader. */
  editLabel?: string;
  onEditToken?: (token: string, chip: HTMLElement) => void;
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

  // After every render: a chip can be inserted, and which ones can change
  // arrives after the field first draws.
  useEffect(() => {
    const chips = ref.current?.querySelectorAll<HTMLElement>("[data-token]");
    for (const chip of chips ?? []) {
      const pencil = chip.querySelector("button");
      const wanted =
        !disabled && editableTokens?.has(chip.dataset.token ?? "") === true;
      if (wanted && !pencil) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = CHIP_EDIT_CLASS;
        button.setAttribute("aria-label", editLabel ?? "");
        button.style.background = CHIP_EDIT_BACKGROUND;
        button.innerHTML = PEN_ICON;
        chip.append(button);
      } else if (!wanted && pencil) {
        pencil.remove();
      }
    }
  });

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
    focus: () => {
      const el = ref.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      // Ready to add to the text, as a click on its end would be.
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      caret.current = range.cloneRange();
    },
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
      // A chip never runs into the word before it ("20EA").
      const before = range.cloneRange();
      before.setStart(el, 0);
      const typed = before.toString();
      if (typed && !/\s$/.test(typed)) {
        range.insertNode(document.createTextNode(" "));
        range.collapse(false);
      }
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
      onMouseDown={(e) => {
        // The pencil never moves the caret or takes focus from the field.
        if ((e.target as HTMLElement).closest("button")) e.preventDefault();
      }}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        const chip = target.closest<HTMLElement>("[data-token]");
        if (target.closest("button") && chip?.dataset.token) {
          onEditToken?.(chip.dataset.token, chip);
        }
      }}
      onKeyUp={keepCaret}
      onMouseUp={keepCaret}
      onBlur={keepCaret}
      onKeyDown={(e) => {
        // Enter on the pencil presses it, and Enter in an input method's
        // composition picks a word.
        if ((e.target as HTMLElement).closest("button")) return;
        if (e.nativeEvent.isComposing) return;
        // A text is one line on the page: Enter finishes the edit.
        if (e.key === "Enter") {
          e.preventDefault();
          ref.current?.blur();
        }
      }}
      onDrop={(e) => e.preventDefault()}
      onPaste={(e) => {
        e.preventDefault();
        const text = e.clipboardData.getData("text/plain").replace(/\s+/g, " ");
        document.execCommand("insertText", false, text);
      }}
      className={cn(
        "min-h-9 w-full min-w-0 whitespace-pre-wrap break-words rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs outline-none",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        disabled && "cursor-not-allowed bg-muted text-muted-foreground",
        struck && "line-through",
        invalid &&
          "border-destructive focus-visible:border-destructive focus-visible:ring-destructive/50",
        className
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
