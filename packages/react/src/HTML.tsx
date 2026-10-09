// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Mention } from "@carbon/tiptap";
import TextStyle from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import type { JSONContent } from "@tiptap/react";
import { generateHTML as DefaultGenerateHTML } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import pkg from "dompurify";
import type { ReactNode } from "react";
import { defaultExtensions } from "./Editor/extensions";
import { cn } from "./utils/cn";

const { sanitize } = pkg;

const generateHTML = (content: JSONContent) => {
  if (typeof window === "undefined") {
    return "";
  }
  if (!content || !("type" in content)) {
    return "";
  }
  const raw = DefaultGenerateHTML(content, [
    ...defaultExtensions,
    TextStyle,
    StarterKit,
    Underline,
    Mention.configure({
      HTMLAttributes: {
        class: "mention"
      }
    })
  ]);
  return sanitize(raw);
};

type HTMLProps = {
  text: string;
};

const HTML = ({ text }: HTMLProps) => {
  return (
    <div className="[&_h1]:text-2xl [&_h1]:font-bold [&_h1]:tracking-tight [&_h2]:text-xl [&_h2]:font-bold [&_h2]:tracking-tight [&_h3]:text-lg [&_h3]:font-bold [&_h3]:tracking-tight [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:ml-4 [&_ol]:ml-4 [&_pre]:bg-gray-100 [&_pre]:p-4 [&_pre]:rounded-md [&_pre]:overflow-auto [&_blockquote]:border-l-4 [&_blockquote]:border-gray-200 [&_blockquote]:pl-4 [&_blockquote]:ml-4 [&_hr]:border-none [&_hr]:border-b-1 [&_hr]:border-gray-200 [&_hr]:my-4">
      <span
        dangerouslySetInnerHTML={
          typeof window === "undefined"
            ? { __html: "" }
            : { __html: sanitize(text) }
        }
      />
    </div>
  );
};

// Nodes that only hold other nodes: empty unless something inside is not.
const CONTAINER_NODES = new Set([
  "doc",
  "paragraph",
  "heading",
  "hardBreak",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote"
]);

/**
 * True when rich text holds nothing to show: no text, image, mention or
 * other leaf. Reads the JSON, not the HTML, so the server (where
 * `generateHTML` returns "") agrees with the browser.
 */
const isRichTextEmpty = (content?: JSONContent | null): boolean => {
  if (!content) return true;
  if (content.type === "text") return !content.text?.trim();
  if (content.type && !CONTAINER_NODES.has(content.type)) return false;
  return (content.content ?? []).every(isRichTextEmpty);
};

/**
 * Read-only rich text (notes on a locked document). Phones show `empty` when
 * there is nothing, so the card does not read as broken; desktop keeps the
 * blank body it always had.
 */
const RichTextView = ({
  content,
  empty,
  className
}: {
  content?: JSONContent | null;
  empty: ReactNode;
  className?: string;
}) => {
  if (isRichTextEmpty(content)) {
    return (
      <p className="hidden text-sm text-muted-foreground max-md:block">
        {empty}
      </p>
    );
  }
  return (
    <div
      className={cn("prose dark:prose-invert", className)}
      dangerouslySetInnerHTML={{
        __html: generateHTML(content as JSONContent)
      }}
    />
  );
};

export { generateHTML, HTML, isRichTextEmpty, RichTextView };
