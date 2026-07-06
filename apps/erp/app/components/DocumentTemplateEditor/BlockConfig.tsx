import type {
  CustomFieldBlock,
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
  DEFAULT_LINE_ITEMS_OPTIONS,
  DEFAULT_SUMMARY_OPTIONS,
  getMergeFields
} from "@carbon/documents/template";
import type { JSONContent } from "@carbon/react";
import {
  Badge,
  Button,
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
import { useState } from "react";
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
import { FOOTER_BLOCK_ID, useDocumentTemplate } from "./context";
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
import { SectionFormModal } from "./SectionFormModal";
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
  const { blocks, sections, selectedId } = useDocumentTemplate();

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
            <h3 className="text-sm font-medium">Footer</h3>
            <TypeBadge category="page" />
          </div>
          <p className="text-xs text-muted-foreground">
            Shown at the bottom of every page.
          </p>
        </div>
        <ChromeConfig kind="footer" />
      </div>
    );
  }

  const block = blocks.find((b) => b.id === selectedId);

  if (!block) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-md border border-dashed px-4 py-8 text-center">
        <LuSlidersHorizontal className="size-5 text-muted-foreground/60" />
        <p className="text-sm text-muted-foreground">
          Select a block to configure it
        </p>
      </div>
    );
  }

  const meta = BLOCK_META[block.type];
  const sharedName =
    block.type === "shared"
      ? (sections.find((s) => s.id === block.sectionId)?.name ?? null)
      : null;
  // Built-in blocks that now expose real options shouldn't show the generic
  // "reorder / toggle" placeholder.
  const hasOwnConfig =
    block.type === "watermark" ||
    block.type === "header" ||
    block.type === "lineItems" ||
    block.type === "summary" ||
    block.type === "terms" ||
    block.type === "labelRevision" ||
    block.type === "labelQuantity" ||
    block.type === "labelTracking" ||
    block.type === "labelBarcode" ||
    block.type === "labelLogo" ||
    block.type === "labelEntityId" ||
    block.type === "operations";

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
        {meta.isBuiltIn && !hasOwnConfig && (
          <p className="text-xs text-muted-foreground">
            Reorder or show/hide it from the list.
          </p>
        )}
      </div>

      {block.type === "header" && <ChromeConfig kind="header" />}
      {block.type === "watermark" && <WatermarkConfig block={block} />}
      {block.type === "lineItems" && <LineItemsConfig block={block} />}
      {block.type === "operations" && <OperationsConfig block={block} />}
      {block.type === "summary" && <SummaryConfig block={block} />}
      {block.type === "terms" && <TermsConfig block={block} />}
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
      {block.type === "shared" && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            {sharedName
              ? "Linked to a shared section. Edit it in the library to update it everywhere."
              : "This shared section no longer exists. Remove the block or recreate the section."}
          </p>
          <Link
            to={path.to.documentSections}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <LuExternalLink className="size-3" />
            Manage shared sections
          </Link>
        </div>
      )}
    </div>
  );
}

type BlockCategory = "page" | "built-in" | "custom" | "shared";

const CATEGORY_LABEL: Record<BlockCategory, string> = {
  page: "Page",
  "built-in": "Built-in",
  custom: "Custom",
  shared: "Shared"
};

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

function TypeBadge({ category }: { category: BlockCategory }) {
  return <Badge variant="secondary">{CATEGORY_LABEL[category]}</Badge>;
}

/**
 * Header & footer are global shared sections — their fields (logo, which
 * company details show) and banner content are edited in a dialog opened right
 * here. The footer also owns its page-number + registration-line settings.
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

/** Footer page-number + registration-line settings. */
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
      <div className={hidden ? "pointer-events-none opacity-60" : undefined}>
        <ToggleRow
          label="Registration line"
          checked={settings.showRegistrationLine}
          onChange={(v) => setSetting("showRegistrationLine", v)}
        />
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

function LineItemsConfig({ block }: { block: LineItemsBlock }) {
  const { updateBlock } = useDocumentTemplate();
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

function RichTextConfig({ block }: { block: RichTextBlock }) {
  const { updateBlock, documentType } = useDocumentTemplate();
  // Bumped on insert to remount the Editor so the appended token shows (Tiptap
  // only reads `initialValue` on mount).
  const [nonce, setNonce] = useState(0);
  const knownTokens = getMergeFields(documentType).map((f) => f.token);

  const insertField = (snippet: string) => {
    updateBlock(block.id, { content: appendText(block.content, snippet) });
    setNonce((n) => n + 1);
  };

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
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label>Content</Label>
          <MergeFieldMenu onInsert={insertField} label="Insert field" />
        </div>
        <Editor
          key={`${block.id}-${nonce}`}
          className="min-h-[140px] w-full rounded-md border bg-background p-3"
          initialValue={block.content}
          onChange={(content) => updateBlock(block.id, { content })}
          highlightTokens={knownTokens}
          disableFileUpload
        />
      </div>
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
  const { updateBlock, termsSeed, documentType } = useDocumentTemplate();
  const [nonce, setNonce] = useState(0);
  const knownTokens = getMergeFields(documentType).map((f) => f.token);

  const initialValue: JSONContent = (hasDocContent(block.content)
    ? block.content
    : termsSeed) ?? {
    type: "doc",
    content: []
  };

  const insertField = (snippet: string) => {
    updateBlock(block.id, { content: appendText(initialValue, snippet) });
    setNonce((n) => n + 1);
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        The terms &amp; conditions printed on this document.
      </p>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label>Content</Label>
          <MergeFieldMenu onInsert={insertField} label="Insert field" />
        </div>
        <Editor
          key={`${block.id}-${nonce}`}
          className="min-h-[160px] w-full rounded-md border bg-background p-3"
          initialValue={initialValue}
          onChange={(content) => updateBlock(block.id, { content })}
          highlightTokens={knownTokens}
          disableFileUpload
        />
      </div>
    </div>
  );
}

function KeyValueConfig({ block }: { block: KeyValueBlock }) {
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
