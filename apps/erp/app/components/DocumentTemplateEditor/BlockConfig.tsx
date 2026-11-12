// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  ApprovalBlock,
  CustomFieldBlock,
  DocumentBlock,
  DocumentBlockType,
  KeyValueBlock,
  LineItemsBlock,
  OperationsBlock,
  RichTextBlock,
  SpacerBlock,
  SummaryBlock,
  TermsBlock,
  WatermarkBlock
} from "@carbon/documents/template";
import {
  BLOCK_META,
  BUILT_IN_SECTION_IDS,
  DEFAULT_APPROVAL_CAPTION,
  DEFAULT_APPROVAL_HEADING,
  DEFAULT_LINE_ITEMS_OPTIONS,
  DEFAULT_SUMMARY_OPTIONS,
  getMergeFields,
  getTextEntries,
  HEADER_TEXT_KEYS
} from "@carbon/documents/template";
import type { JSONContent } from "@carbon/react";
import {
  Badge,
  Button,
  cn,
  IconButton,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { Trans, useLingui } from "@lingui/react/macro";
import { type ReactNode, useState } from "react";
import {
  LuExternalLink,
  LuPencil,
  LuPlus,
  LuSlidersHorizontal,
  LuTrash2
} from "react-icons/lu";
import { Link } from "react-router";
import { path } from "~/utils/path";
import { ToggleRow } from "./configHelpers";
import {
  FOOTER_BLOCK_ID,
  useDocumentTemplate,
  useEditorStore,
  useTextErrors
} from "./context";
import {
  FieldConfig,
  HeaderLogoConfig,
  LabelBarcodeConfig,
  LabelEntityIdConfig,
  LabelFieldNameConfig,
  LabelLogoConfig
} from "./labelConfigs";
import { MergeFieldMenu } from "./MergeFieldMenu";
import { NumberRow } from "./NumberRow";
import { RememberedSection } from "./PanelSection";
import { SectionFormModal } from "./SectionFormModal";
import { DocumentTextConfig, TextConfig } from "./TextConfig";
import { HEADER_LOGO_ID } from "./useHeaderConfig";

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

export function BlockConfig() {
  const { blocks, sections, selectedId, documentType } = useDocumentTemplate();
  // One record's document: only its words, Terms and Notes, never the layout.
  const isDocument = useEditorStore((s) => s.document !== null);

  if (selectedId === HEADER_LOGO_ID) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Logo</h3>
            <TypeBadge category="page" />
          </div>
          <p className="text-xs text-muted-foreground">
            Shown in the header of every document.
          </p>
        </div>
        <HeaderLogoConfig />
      </div>
    );
  }

  if (selectedId === FOOTER_BLOCK_ID) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">
              <Trans>Footer</Trans>
            </h3>
            <TypeBadge category="page" />
          </div>
          <p className="text-xs text-muted-foreground">
            <Trans>Shown at the bottom of every page.</Trans>
          </p>
        </div>
        {!isDocument && (
          <RememberedSection
            id="options:footer"
            title={<Trans>Options</Trans>}
            className="-mx-3 border-t"
          >
            <ChromeConfig kind="footer" />
          </RememberedSection>
        )}
        <DocumentTextConfig except={HEADER_TEXT_KEYS} />
      </div>
    );
  }

  const block = blocks.find((b) => b.id === selectedId);

  if (!block) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-md border border-dashed px-4 py-8 text-center">
        <LuSlidersHorizontal className="size-5 text-muted-foreground/60" />
        <p className="text-sm text-muted-foreground">
          <Trans>Select a block to configure it</Trans>
        </p>
      </div>
    );
  }

  const meta = BLOCK_META[block.type];
  const hasTexts = getTextEntries(documentType, block.type).length > 0;
  const hasOptions = OPTION_TYPES.has(block.type);
  const sharedName =
    block.type === "shared"
      ? (sections.find((s) => s.id === block.sectionId)?.name ?? null)
      : null;
  // Built-in blocks that now expose real options shouldn't show the generic
  // "reorder / toggle" placeholder.
  const hasOwnConfig = hasOptions || hasTexts;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">
            {block.type === "shared"
              ? (sharedName ?? "Shared Section")
              : meta.label}
          </h3>
          <TypeBadge category={categoryOf(block.type)} />
        </div>
        {meta.isBuiltIn && !hasOwnConfig && !isDocument && (
          <p className="text-xs text-muted-foreground">
            <Trans>Reorder or show/hide it from the list.</Trans>
          </p>
        )}
      </div>

      {isDocument && block.type === "terms" && (
        <RememberedSection
          id="document:terms"
          title={<Trans>Terms</Trans>}
          className="-mx-3 border-t"
        >
          <ReadOnlyWhenLocked>
            <TermsConfig block={block} />
          </ReadOnlyWhenLocked>
        </RememberedSection>
      )}
      {isDocument && block.type === "notes" && <NotesConfig />}
      {hasOptions && !isDocument && (
        <RememberedSection
          id={`options:${block.type}`}
          title={<Trans>Options</Trans>}
          className="-mx-3 border-t"
        >
          <div className="flex flex-col gap-4">
            <BlockOptions block={block} />
          </div>
        </RememberedSection>
      )}
      {block.type === "header" && (
        <DocumentTextConfig only={HEADER_TEXT_KEYS} />
      )}
      <BlockFieldErrors block={block} />
      <TextConfig block={block} />
      {block.type === "shared" && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            {sharedName ? (
              <Trans>
                Linked to a shared section. Edit it in the library to update it
                everywhere.
              </Trans>
            ) : (
              <Trans>
                This shared section no longer exists. Remove the block or
                recreate the section.
              </Trans>
            )}
          </p>
          {/* Leaving the page would lose a document's unsaved edits. */}
          {!isDocument && (
            <Link
              to={path.to.documentSections}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <LuExternalLink className="size-3" />
              <Trans>Manage shared sections</Trans>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A locked record's document is read-only. The rich text editor has no
 * read-only mode, so the subtree is made inert: no focus, no typing.
 */
function ReadOnlyWhenLocked({ children }: { children: ReactNode }) {
  const locked = useEditorStore((s) => s.document?.locked ?? false);
  return (
    <div
      ref={(el) => {
        if (!el) return;
        if (locked) el.setAttribute("inert", "");
        else el.removeAttribute("inert");
      }}
      className={cn(locked && "opacity-60")}
    >
      {children}
    </div>
  );
}

/**
 * The record's own notes, as its Notes block prints them. They are the same
 * notes the record's page edits, so there is one copy of the text.
 */
function NotesConfig() {
  const { t } = useLingui();
  const notes = useEditorStore((s) => s.notes);
  const setNotes = useEditorStore((s) => s.setNotes);
  const hasNotes = useEditorStore((s) => s.document?.hasNotes ?? false);
  if (!hasNotes) return null;

  return (
    <RememberedSection
      id="document:notes"
      title={t`Notes`}
      className="-mx-3 border-t"
    >
      <ReadOnlyWhenLocked>
        <p className="mb-2 text-xs text-muted-foreground">
          <Trans>
            These are the record's own notes. Changing them here changes them on
            the record too.
          </Trans>
        </p>
        <Editor
          className="min-h-[140px] w-full rounded-md border bg-transparent p-3"
          initialValue={notes ?? { type: "doc", content: [] }}
          onChange={setNotes}
          disableFileUpload
        />
      </ReadOnlyWhenLocked>
    </RememberedSection>
  );
}

/** Blocks with settings of their own, shown under "Options". */
const OPTION_TYPES = new Set<DocumentBlockType>([
  "header",
  "watermark",
  "lineItems",
  "operations",
  "summary",
  "terms",
  "approval",
  "labelRevision",
  "labelQuantity",
  "labelTracking",
  "richText",
  "keyValue",
  "spacer",
  "field",
  "labelBarcode",
  "labelLogo",
  "labelEntityId",
  "customField"
]);

function BlockOptions({ block }: { block: DocumentBlock }) {
  return (
    <>
      {block.type === "header" && <ChromeConfig kind="header" />}
      {block.type === "watermark" && <WatermarkConfig block={block} />}
      {block.type === "lineItems" && <LineItemsConfig block={block} />}
      {block.type === "operations" && <OperationsConfig block={block} />}
      {block.type === "summary" && <SummaryConfig block={block} />}
      {block.type === "terms" && <TermsConfig block={block} />}
      {block.type === "approval" && <ApprovalConfig block={block} />}
      {(block.type === "labelRevision" ||
        block.type === "labelQuantity" ||
        block.type === "labelTracking") && (
        <LabelFieldNameConfig block={block} />
      )}
      {block.type === "richText" && <RichTextConfig block={block} />}
      {block.type === "keyValue" && <KeyValueConfig block={block} />}
      {block.type === "spacer" && <SpacerConfig block={block} />}
      {block.type === "field" && <FieldConfig block={block} />}
      {block.type === "labelBarcode" && <LabelBarcodeConfig block={block} />}
      {block.type === "labelLogo" && <LabelLogoConfig block={block} />}
      {block.type === "labelEntityId" && <LabelEntityIdConfig block={block} />}
      {block.type === "customField" && <CustomFieldConfig block={block} />}
    </>
  );
}

type BlockCategory = "page" | "built-in" | "custom" | "shared";

function categoryOf(type: DocumentBlockType): BlockCategory {
  if (type === "header") return "page";
  if (type === "shared") return "shared";
  if (
    type === "richText" ||
    type === "keyValue" ||
    type === "spacer" ||
    type === "field" ||
    type === "customField"
  ) {
    return "custom";
  }
  return "built-in";
}

/** Errors on a block's own fields (its content, a row, its tax label): no text shows them. */
function BlockFieldErrors({ block }: { block: DocumentBlock }) {
  const { documentType } = useDocumentTemplate();
  const textErrors = useTextErrors();
  const prefix = `${block.id}:`;
  const catalog = new Set(
    getTextEntries(documentType, block.type).map(
      (entry) => `${prefix}${entry.key}`
    )
  );
  const errors = Object.entries(textErrors).filter(
    ([key]) => key.startsWith(prefix) && !catalog.has(key)
  );
  if (errors.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 text-xs text-destructive">
      {errors.map(([key, error]) => (
        <span key={key}>{error}</span>
      ))}
    </div>
  );
}

function TypeBadge({ category }: { category: BlockCategory }) {
  const { t } = useLingui();
  const label: Record<BlockCategory, string> = {
    page: t`Page`,
    "built-in": t`Built-in`,
    custom: t`Custom`,
    shared: t`Shared`
  };
  return <Badge variant="secondary">{label[category]}</Badge>;
}

/**
 * Header & footer are global shared sections — their config (header: logo +
 * which company details show; footer: registration line) and content are
 * edited in a dialog opened right here. Page numbers stay per-template below.
 */
function ChromeConfig({ kind }: { kind: "header" | "footer" }) {
  const { sections } = useDocumentTemplate();
  const [open, setOpen] = useState(false);
  const targetId =
    kind === "header"
      ? BUILT_IN_SECTION_IDS.header
      : BUILT_IN_SECTION_IDS.footer;
  const section = sections.find((s) => s.id === targetId);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {kind === "header"
          ? "The header is shared by every document — same logo, fields, and banner everywhere."
          : "The footer is shared by every document."}
      </p>
      <Button
        variant="secondary"
        leftIcon={<LuPencil />}
        onClick={() => setOpen(true)}
        isDisabled={!section}
      >
        Edit {kind} section
      </Button>

      {kind === "footer" && <FooterSettings />}

      <Link
        to={path.to.documentSections}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <LuExternalLink className="size-3" />
        Open section library
      </Link>

      {open && section && (
        <SectionFormModal
          action={path.to.documentSections}
          onClose={() => setOpen(false)}
          section={{
            id: section.id,
            name: section.name,
            placement: section.placement,
            content: section.content ?? { type: "doc", content: [] },
            config: section.config
          }}
        />
      )}
    </div>
  );
}

/** Footer page-number settings. The registration line is configured on the
 * shared footer section itself (edit the footer section to change it). */
function FooterSettings() {
  const { footerSectionId, settings, setSetting } = useDocumentTemplate();
  const hidden = footerSectionId === null;
  const pageNumbersValue = settings.showPageNumbers
    ? settings.pageNumberFormat
    : "none";

  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      {hidden && (
        <p className="text-xs text-muted-foreground">
          Footer is hidden — turn it on with the eye toggle to apply these.
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm">Page numbers</span>
        <Select
          disabled={hidden}
          value={pageNumbersValue}
          onValueChange={(v) => {
            if (v === "none") {
              setSetting("showPageNumbers", false);
            } else {
              setSetting("showPageNumbers", true);
              setSetting(
                "pageNumberFormat",
                v as typeof settings.pageNumberFormat
              );
            }
          }}
        >
          <SelectTrigger className="h-7 w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            <SelectItem value="pageOfTotal">Page 1 of 3</SelectItem>
            <SelectItem value="page">Page 1</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function CustomFieldConfig({ block }: { block: CustomFieldBlock }) {
  const { updateBlock, customFields } = useDocumentTemplate();
  const field = customFields.find((f) => f.id === block.fieldId);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cf-label">Label</Label>
        <Input
          id="cf-label"
          value={block.label}
          placeholder={field?.name ?? ""}
          onChange={(e) => updateBlock(block.id, { label: e.target.value })}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {field
          ? `Value comes from the “${field.name}” custom field.`
          : "This custom field no longer exists. Remove the block."}
      </p>
    </div>
  );
}

function SummaryConfig({ block }: { block: SummaryBlock }) {
  const { updateBlock } = useDocumentTemplate();
  const opts = { ...DEFAULT_SUMMARY_OPTIONS, ...block.options };

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="tax-label">Tax label</Label>
      <Input
        id="tax-label"
        value={opts.taxLabel}
        placeholder="Taxes"
        onChange={(e) =>
          updateBlock(block.id, {
            options: { ...opts, taxLabel: e.target.value }
          })
        }
      />
      <p className="text-xs text-muted-foreground">
        Shown on the tax row, e.g. "VAT 15%".
      </p>
    </div>
  );
}

function WatermarkConfig({ block }: { block: WatermarkBlock }) {
  const { updateBlock, hasWatermark } = useDocumentTemplate();
  return (
    <div className="flex flex-col gap-3">
      <NumberRow
        label="Opacity (%)"
        minValue={1}
        maxValue={100}
        value={Math.round((block.opacity ?? 0.07) * 100)}
        onChange={(v) => updateBlock(block.id, { opacity: v / 100 })}
      />
      <NumberRow
        label="Size (% of width)"
        minValue={10}
        maxValue={100}
        value={block.size ?? 50}
        onChange={(v) => updateBlock(block.id, { size: v })}
      />
      <div className="flex flex-col gap-1.5">
        <Label>Placement</Label>
        <Select
          value={block.placement ?? "center"}
          onValueChange={(v) =>
            updateBlock(block.id, {
              placement: v as WatermarkBlock["placement"]
            })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="top">Top</SelectItem>
            <SelectItem value="center">Center</SelectItem>
            <SelectItem value="bottom">Bottom</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <p className="text-xs text-muted-foreground">
        {hasWatermark
          ? "Your watermark logo (set in Logos), faint behind the document."
          : "Upload a watermark logo in Logos to see it."}
      </p>
    </div>
  );
}

function OperationsConfig({ block }: { block: OperationsBlock }) {
  const { updateBlock } = useDocumentTemplate();
  return (
    <ToggleRow
      label="Show work instructions"
      checked={block.showWorkInstructions ?? false}
      onChange={(v) => updateBlock(block.id, { showWorkInstructions: v })}
    />
  );
}

/**
 * The Line Items block's options: thumbnails, striped rows, item text
 * overflow, and the Show Supplier Part ID switch on purchase orders only.
 */
function LineItemsConfig({ block }: { block: LineItemsBlock }) {
  const { t } = useLingui();
  const { updateBlock, documentType } = useDocumentTemplate();
  const opts = { ...DEFAULT_LINE_ITEMS_OPTIONS, ...block.options };
  const set = <K extends keyof typeof opts>(key: K, value: (typeof opts)[K]) =>
    updateBlock(block.id, { options: { ...opts, [key]: value } });

  return (
    <div className="flex flex-col gap-3">
      <ToggleRow
        label="Show thumbnails"
        checked={opts.showThumbnails}
        onChange={(v) => set("showThumbnails", v)}
      />
      <ToggleRow
        label="Striped rows"
        checked={opts.zebra}
        onChange={(v) => set("zebra", v)}
      />
      {documentType === "purchaseOrder" && (
        <ToggleRow
          label={t`Show Supplier Part ID`}
          checked={opts.showSupplierPartId}
          onChange={(v) => set("showSupplierPartId", v)}
        />
      )}
      <div className="flex flex-col gap-1.5">
        <Label>Item text</Label>
        <Select
          value={opts.textOverflow}
          onValueChange={(v) =>
            set("textOverflow", v as typeof opts.textOverflow)
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="wrap">Wrap to new lines</SelectItem>
            <SelectItem value="truncate">Truncate to one line</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
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

function RichTextConfig({ block }: { block: RichTextBlock }) {
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
function TermsConfig({ block }: { block: TermsBlock }) {
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
function ApprovalConfig({ block }: { block: ApprovalBlock }) {
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

function KeyValueConfig({ block }: { block: KeyValueBlock }) {
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

function SpacerConfig({ block }: { block: SpacerBlock }) {
  const { updateBlock } = useDocumentTemplate();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label>Style</Label>
        <Select
          value={block.variant}
          onValueChange={(variant) =>
            updateBlock(block.id, {
              variant: variant as SpacerBlock["variant"]
            })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="space">Empty space</SelectItem>
            <SelectItem value="divider">Divider line</SelectItem>
            <SelectItem value="pageBreak">Page break</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {block.variant === "space" && (
        <NumberRow
          label="Height (pt)"
          minValue={0}
          maxValue={200}
          value={block.size ?? 16}
          onChange={(v) => updateBlock(block.id, { size: v })}
        />
      )}
    </div>
  );
}
