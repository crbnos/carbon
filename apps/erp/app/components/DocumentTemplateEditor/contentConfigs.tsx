// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  ApprovalBlock,
  KeyValueBlock,
  RichTextBlock,
  TermsBlock
} from "@carbon/documents/template";
import {
  DEFAULT_APPROVAL_CAPTION,
  DEFAULT_APPROVAL_HEADING,
  getMergeFields
} from "@carbon/documents/template";
import type { JSONContent } from "@carbon/react";
import { Button, IconButton, Input, Label } from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuPlus, LuTrash2 } from "react-icons/lu";
import { ToggleRow } from "./configHelpers";
import { useDocumentTemplate } from "./context";
import { MergeFieldMenu } from "./MergeFieldMenu";

/** Append a `{{token}}` snippet to the end of a tiptap doc (inline if possible). */
function appendText(content: JSONContent, text: string): JSONContent {
  const doc =
    content && content.type === "doc"
      ? content
      : ({ type: "doc", content: [] } as JSONContent);
  const nodes = Array.isArray(doc.content) ? [...doc.content] : [];
  const last = nodes[nodes.length - 1];
  if (last && last.type === "paragraph") {
    const inline = Array.isArray(last.content) ? [...last.content] : [];
    inline.push({ type: "text", text: inline.length ? ` ${text}` : text });
    nodes[nodes.length - 1] = { ...last, content: inline };
  } else {
    nodes.push({ type: "paragraph", content: [{ type: "text", text }] });
  }
  return { ...doc, type: "doc", content: nodes };
}

/** A block's rich text, with the document's variables to insert. */
function TokenEditor({
  block,
  label,
  content,
  minHeight
}: {
  block: RichTextBlock | TermsBlock | ApprovalBlock;
  label: string;
  content: JSONContent;
  minHeight: string;
}) {
  const { t } = useLingui();
  const { updateBlock, documentType } = useDocumentTemplate();
  // Bumped on insert to remount the Editor so the appended token shows (Tiptap
  // only reads `initialValue` on mount).
  const [nonce, setNonce] = useState(0);
  const knownTokens = getMergeFields(documentType).map((f) => f.token);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <MergeFieldMenu
          label={t`Insert field`}
          onInsert={(snippet) => {
            updateBlock(block.id, { content: appendText(content, snippet) });
            setNonce((n) => n + 1);
          }}
        />
      </div>
      <Editor
        label={label}
        key={`${block.id}-${nonce}`}
        className={`${minHeight} w-full rounded-md border bg-transparent p-3`}
        initialValue={content}
        onChange={(next) => updateBlock(block.id, { content: next })}
        highlightTokens={knownTokens}
        disableFileUpload
      />
    </div>
  );
}

export function RichTextConfig({ block }: { block: RichTextBlock }) {
  const { t } = useLingui();
  const { updateBlock } = useDocumentTemplate();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rt-title">Heading (optional)</Label>
        <Input
          id="rt-title"
          value={block.title ?? ""}
          onChange={(e) => updateBlock(block.id, { title: e.target.value })}
        />
      </div>
      <TokenEditor
        block={block}
        label={t`Content`}
        content={block.content}
        minHeight="min-h-[140px]"
      />
    </div>
  );
}

function hasDocContent(content?: JSONContent | null): boolean {
  return Boolean(
    content && Array.isArray(content.content) && content.content.length > 0
  );
}

/**
 * Per-document Terms & Conditions. The block stores its own content; when left
 * empty it falls back to the company terms setting at render. The editor seeds
 * the field with that setting (`termsSeed`) so the current value is the starting
 * point.
 */
export function TermsConfig({ block }: { block: TermsBlock }) {
  const { t } = useLingui();
  const { termsSeed } = useDocumentTemplate();

  const initialValue: JSONContent = (hasDocContent(block.content)
    ? block.content
    : termsSeed) ?? {
    type: "doc",
    content: []
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        <Trans>The terms &amp; conditions printed on this document.</Trans>
      </p>
      <TokenEditor
        block={block}
        label={t`Content`}
        content={initialValue}
        minHeight="min-h-[160px]"
      />
    </div>
  );
}

/**
 * The Approval block: its heading, whether the signature prints, and the
 * caption under the line. The caption starts as the approver and the date, so
 * "Approved by … on …" is written here rather than in a separate block.
 */
export function ApprovalConfig({ block }: { block: ApprovalBlock }) {
  const { t } = useLingui();
  const { updateBlock } = useDocumentTemplate();
  const caption = hasDocContent(block.content)
    ? (block.content as JSONContent)
    : DEFAULT_APPROVAL_CAPTION;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Prints once the order is approved.
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="approval-heading">Heading</Label>
        <Input
          id="approval-heading"
          value={block.heading ?? DEFAULT_APPROVAL_HEADING}
          onChange={(e) => updateBlock(block.id, { heading: e.target.value })}
        />
      </div>
      <ToggleRow
        label="Show signature"
        checked={block.showSignature ?? true}
        onChange={(v) => updateBlock(block.id, { showSignature: v })}
      />
      <TokenEditor
        block={block}
        label={t`Caption`}
        content={caption}
        minHeight="min-h-[96px]"
      />
    </div>
  );
}

export function KeyValueConfig({ block }: { block: KeyValueBlock }) {
  const { t } = useLingui();
  const { updateBlock } = useDocumentTemplate();
  const rows = block.rows ?? [];

  const setRows = (next: KeyValueBlock["rows"]) =>
    updateBlock(block.id, { rows: next });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="kv-title">Heading (optional)</Label>
        <Input
          id="kv-title"
          value={block.title ?? ""}
          onChange={(e) => updateBlock(block.id, { title: e.target.value })}
        />
      </div>

      <div className="flex flex-col gap-2">
        {rows.map((row, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              placeholder="Label"
              aria-label={t`Label ${index + 1}`}
              value={row.label}
              onChange={(e) =>
                setRows(
                  rows.map((r, i) =>
                    i === index ? { ...r, label: e.target.value } : r
                  )
                )
              }
            />
            <Input
              placeholder="Value"
              aria-label={t`Value ${index + 1}`}
              value={row.value}
              onChange={(e) =>
                setRows(
                  rows.map((r, i) =>
                    i === index ? { ...r, value: e.target.value } : r
                  )
                )
              }
            />
            <MergeFieldMenu
              label=""
              onInsert={(snippet) =>
                setRows(
                  rows.map((r, i) =>
                    i === index ? { ...r, value: r.value + snippet } : r
                  )
                )
              }
            />
            <IconButton
              size="sm"
              variant="ghost"
              aria-label="Remove row"
              icon={<LuTrash2 />}
              onClick={() => setRows(rows.filter((_, i) => i !== index))}
            />
          </div>
        ))}
        <Button
          variant="secondary"
          leftIcon={<LuPlus />}
          onClick={() => setRows([...rows, { label: "", value: "" }])}
        >
          Add row
        </Button>
      </div>
    </div>
  );
}
