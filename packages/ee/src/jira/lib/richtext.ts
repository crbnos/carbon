/**
 * Utilities for bidirectional conversion between Atlassian Document Format (ADF)
 * and Tiptap JSON (Carbon's rich text format).
 *
 * Jira Cloud uses ADF for rich text fields like description.
 * Carbon uses Tiptap/ProseMirror JSON for rich text editing.
 *
 * ADF documentation: https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/
 */

// Tiptap (ProseMirror) JSON format
export type TiptapNode = {
  type: string;
  attrs?: Record<string, any>;
  content?: TiptapNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, any> }[];
};

export type TiptapDocument = {
  type: "doc";
  content: TiptapNode[];
};

// ADF (Atlassian Document Format) types
export type ADFNode = {
  type: string;
  attrs?: Record<string, any>;
  content?: ADFNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, any> }[];
};

export type ADFDocument = {
  version: 1;
  type: "doc";
  content: ADFNode[];
};

/**
 * Convert ADF (Atlassian Document Format) to Tiptap JSON.
 * Used when syncing from Jira → Carbon.
 */
export function adfToTiptap(adf: ADFDocument | null | undefined): TiptapDocument {
  if (!adf || !adf.content || adf.content.length === 0) {
    return { type: "doc", content: [{ type: "paragraph" }] };
  }

  const content = adf.content.map(convertADFNodeToTiptap).filter(Boolean) as TiptapNode[];

  if (content.length === 0) {
    return { type: "doc", content: [{ type: "paragraph" }] };
  }

  return { type: "doc", content };
}

function convertADFNodeToTiptap(node: ADFNode): TiptapNode | null {
  switch (node.type) {
    case "paragraph":
      return {
        type: "paragraph",
        content: node.content?.map(convertADFNodeToTiptap).filter(Boolean) as TiptapNode[] || []
      };

    case "heading":
      return {
        type: "heading",
        attrs: { level: node.attrs?.level ?? 1 },
        content: node.content?.map(convertADFNodeToTiptap).filter(Boolean) as TiptapNode[] || []
      };

    case "bulletList":
      return {
        type: "bulletList",
        content: node.content?.map(convertADFNodeToTiptap).filter(Boolean) as TiptapNode[] || []
      };

    case "orderedList":
      return {
        type: "orderedList",
        content: node.content?.map(convertADFNodeToTiptap).filter(Boolean) as TiptapNode[] || []
      };

    case "listItem":
      return {
        type: "listItem",
        content: node.content?.map(convertADFNodeToTiptap).filter(Boolean) as TiptapNode[] || []
      };

    case "blockquote":
      return {
        type: "blockquote",
        content: node.content?.map(convertADFNodeToTiptap).filter(Boolean) as TiptapNode[] || []
      };

    case "codeBlock":
      return {
        type: "codeBlock",
        attrs: node.attrs?.language ? { language: node.attrs.language } : undefined,
        content: node.content?.map(convertADFNodeToTiptap).filter(Boolean) as TiptapNode[] || []
      };

    case "rule":
      return { type: "horizontalRule" };

    case "hardBreak":
      return { type: "hardBreak" };

    case "text":
      return {
        type: "text",
        text: node.text ?? "",
        marks: node.marks?.map(convertADFMarkToTiptap).filter(Boolean) as TiptapNode["marks"]
      };

    case "mention":
      // Convert Jira mentions to plain text
      return {
        type: "text",
        text: node.attrs?.text || "@mention"
      };

    case "emoji":
      return {
        type: "text",
        text: node.attrs?.shortName || node.attrs?.text || ""
      };

    case "inlineCard":
    case "blockCard":
      // Convert Jira cards to links
      return {
        type: "text",
        text: node.attrs?.url || "",
        marks: node.attrs?.url
          ? [{ type: "link", attrs: { href: node.attrs.url } }]
          : undefined
      };

    case "mediaGroup":
    case "mediaSingle":
      // Skip media for now - could be enhanced to handle attachments
      return null;

    case "table":
    case "tableRow":
    case "tableCell":
    case "tableHeader":
      // Tables are complex - skip for now
      return null;

    default:
      // For unknown types, try to extract text content
      if (node.content) {
        return {
          type: "paragraph",
          content: node.content.map(convertADFNodeToTiptap).filter(Boolean) as TiptapNode[]
        };
      }
      return null;
  }
}

function convertADFMarkToTiptap(
  mark: NonNullable<ADFNode["marks"]>[number]
): NonNullable<TiptapNode["marks"]>[number] | null {
  switch (mark.type) {
    case "strong":
      return { type: "bold" };
    case "em":
      return { type: "italic" };
    case "strike":
      return { type: "strike" };
    case "code":
      return { type: "code" };
    case "link":
      return { type: "link", attrs: { href: mark.attrs?.href } };
    case "underline":
      return { type: "underline" };
    case "textColor":
      return { type: "textStyle", attrs: { color: mark.attrs?.color } };
    case "subsup":
      // Subscript/superscript - map to appropriate type or skip
      return null;
    default:
      return null;
  }
}

/**
 * Convert Tiptap JSON to ADF (Atlassian Document Format).
 * Used when syncing from Carbon → Jira.
 */
export function tiptapToAdf(tiptapDoc: TiptapDocument | null | undefined): ADFDocument {
  if (!tiptapDoc || !tiptapDoc.content || tiptapDoc.content.length === 0) {
    return {
      version: 1,
      type: "doc",
      content: [{ type: "paragraph", content: [] }]
    };
  }

  const content = tiptapDoc.content.map(convertTiptapNodeToADF).filter(Boolean) as ADFNode[];

  if (content.length === 0) {
    return {
      version: 1,
      type: "doc",
      content: [{ type: "paragraph", content: [] }]
    };
  }

  return { version: 1, type: "doc", content };
}

function convertTiptapNodeToADF(node: TiptapNode): ADFNode | null {
  switch (node.type) {
    case "paragraph":
      return {
        type: "paragraph",
        content: node.content?.map(convertTiptapNodeToADF).filter(Boolean) as ADFNode[] || []
      };

    case "heading":
      return {
        type: "heading",
        attrs: { level: node.attrs?.level ?? 1 },
        content: node.content?.map(convertTiptapNodeToADF).filter(Boolean) as ADFNode[] || []
      };

    case "bulletList":
      return {
        type: "bulletList",
        content: node.content?.map(convertTiptapNodeToADF).filter(Boolean) as ADFNode[] || []
      };

    case "orderedList":
      return {
        type: "orderedList",
        content: node.content?.map(convertTiptapNodeToADF).filter(Boolean) as ADFNode[] || []
      };

    case "listItem":
      return {
        type: "listItem",
        content: node.content?.map(convertTiptapNodeToADF).filter(Boolean) as ADFNode[] || []
      };

    case "blockquote":
      return {
        type: "blockquote",
        content: node.content?.map(convertTiptapNodeToADF).filter(Boolean) as ADFNode[] || []
      };

    case "codeBlock":
      return {
        type: "codeBlock",
        attrs: node.attrs?.language ? { language: node.attrs.language } : {},
        content: node.content?.map(convertTiptapNodeToADF).filter(Boolean) as ADFNode[] || []
      };

    case "horizontalRule":
      return { type: "rule" };

    case "hardBreak":
      return { type: "hardBreak" };

    case "text":
      return {
        type: "text",
        text: node.text ?? "",
        marks: node.marks?.map(convertTiptapMarkToADF).filter(Boolean) as ADFNode["marks"]
      };

    default:
      // For unknown types, try to extract text content
      if (node.content) {
        return {
          type: "paragraph",
          content: node.content.map(convertTiptapNodeToADF).filter(Boolean) as ADFNode[]
        };
      }
      return null;
  }
}

function convertTiptapMarkToADF(
  mark: NonNullable<TiptapNode["marks"]>[number]
): NonNullable<ADFNode["marks"]>[number] | null {
  switch (mark.type) {
    case "bold":
      return { type: "strong" };
    case "italic":
      return { type: "em" };
    case "strike":
      return { type: "strike" };
    case "code":
      return { type: "code" };
    case "link":
      return { type: "link", attrs: { href: mark.attrs?.href } };
    case "underline":
      return { type: "underline" };
    case "textStyle":
      if (mark.attrs?.color) {
        return { type: "textColor", attrs: { color: mark.attrs.color } };
      }
      return null;
    default:
      return null;
  }
}

/**
 * Check if two Tiptap documents have the same content.
 * Used to prevent unnecessary syncs when content hasn't changed.
 */
export function tiptapDocumentsEqual(
  a: TiptapDocument | null | undefined,
  b: TiptapDocument | null | undefined
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;

  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Check if a Tiptap document is empty (no meaningful content).
 */
export function isTiptapEmpty(doc: TiptapDocument | null | undefined): boolean {
  if (!doc || !doc.content) return true;

  const hasContent = doc.content.some((node) => {
    if (node.type === "paragraph" && node.content) {
      return node.content.some(
        (inline) => inline.type === "text" && inline.text?.trim()
      );
    }
    return node.content && node.content.length > 0;
  });

  return !hasContent;
}
