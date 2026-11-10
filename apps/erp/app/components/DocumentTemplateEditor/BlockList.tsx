// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  DocumentBlock,
  DocumentBlockType
} from "@carbon/documents/template";
import {
  BLOCK_META,
  BUILT_IN_SECTION_IDS,
  extensionSupport
} from "@carbon/documents/template";
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton
} from "@carbon/react";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Trans, useLingui } from "@lingui/react/macro";
import { Fragment, type ReactNode } from "react";
import {
  LuEye,
  LuEyeOff,
  LuFileText,
  LuGripVertical,
  LuHash,
  LuImage,
  LuInfo,
  LuLibrary,
  LuLock,
  LuPanelBottom,
  LuPanelTop,
  LuPlus,
  LuQrCode,
  LuReceipt,
  LuSeparatorHorizontal,
  LuStamp,
  LuStickyNote,
  LuTable,
  LuTag,
  LuTrash2,
  LuType,
  LuUsers
} from "react-icons/lu";
import { Link } from "react-router";
import { POINTER_SENSOR_OPTIONS } from "~/utils/drag-sensors";
import { path } from "~/utils/path";
import {
  type AddableBlockType,
  FOOTER_BLOCK_ID,
  type SectionRef,
  useDocumentTemplate,
  useEditorStore,
  usePickBlock
} from "./context";
import { HEADER_LOGO_ID, useHeaderConfig } from "./useHeaderConfig";

const ADD_OPTIONS: {
  type: AddableBlockType;
  icon: ReactNode;
  description: string;
}[] = [
  {
    type: "richText",
    icon: <LuType className="size-4" />,
    description: "Formatted text with merge fields"
  },
  {
    type: "keyValue",
    icon: <LuTable className="size-4" />,
    description: "Label / value rows"
  },
  {
    type: "spacer",
    icon: <LuSeparatorHorizontal className="size-4" />,
    description: "Space, divider, or page break"
  }
];

/** A consistent leading icon per block type, so every row reads the same. */
const BLOCK_ICON: Partial<Record<DocumentBlockType, ReactNode>> = {
  header: <LuPanelTop className="size-4" />,
  watermark: <LuStamp className="size-4" />,
  parties: <LuUsers className="size-4" />,
  details: <LuInfo className="size-4" />,
  lineItems: <LuTable className="size-4" />,
  summary: <LuReceipt className="size-4" />,
  terms: <LuFileText className="size-4" />,
  notes: <LuStickyNote className="size-4" />,
  richText: <LuType className="size-4" />,
  keyValue: <LuTable className="size-4" />,
  spacer: <LuSeparatorHorizontal className="size-4" />,
  shared: <LuLibrary className="size-4" />,
  field: <LuType className="size-4" />,
  customField: <LuTag className="size-4" />,
  labelLogo: <LuImage className="size-4" />,
  labelBarcode: <LuQrCode className="size-4" />,
  labelEntityId: <LuHash className="size-4" />
};

function blockIcon(type: DocumentBlockType): ReactNode {
  return BLOCK_ICON[type] ?? <LuType className="size-4" />;
}

/** Whether the editor is on one record's document, and whether it is locked. */
function useDocumentModeFlags() {
  const isDocument = useEditorStore((s) => s.document !== null);
  const locked = useEditorStore((s) => s.document?.locked ?? false);
  return { isDocument, locked };
}

/** Blocks that print in the body: everything but the header. */
function useBodyBlocks() {
  const { blocks } = useDocumentTemplate();
  return blocks.filter((b) => b.type !== "header");
}

/** Body blocks switched off, listed apart under "Not on the page". */
export function useHiddenBlockCount() {
  return useBodyBlocks().filter((b) => !b.visible).length;
}

/**
 * The header with its logo, and the watermark behind the page: page chrome,
 * pinned (not reorderable).
 */
export function PageTopRows() {
  const { blocks } = useDocumentTemplate();
  const headerBlock = blocks.find((b) => b.type === "header");
  const watermark = blocks.find((b) => b.type === "watermark" && b.visible);
  return (
    <div className="flex flex-col gap-1">
      {headerBlock && <HeaderRow id={headerBlock.id} />}
      {headerBlock && <HeaderLogoRow />}
      {watermark && <StaticBlockRow id={watermark.id} />}
    </div>
  );
}

/** The body blocks on the page, in print order and sortable. */
export function BodyBlockList() {
  const { reorder } = useDocumentTemplate();
  // The watermark prints behind the whole page, so it sits under "Top of page".
  const shownBlocks = useBodyBlocks().filter(
    (b) => b.visible && b.type !== "watermark"
  );
  // The Summary (totals) belongs to the Line Items table, so it's shown nested
  // under it in the tree rather than as a separate sortable row. Only nest when
  // a Line Items block is actually on the page.
  const hasLineItems = shownBlocks.some((b) => b.type === "lineItems");
  const summaryBlock = hasLineItems
    ? shownBlocks.find((b) => b.type === "summary")
    : undefined;
  const sortableBlocks = summaryBlock
    ? shownBlocks.filter((b) => b.id !== summaryBlock.id)
    : shownBlocks;
  const sensors = useSensors(
    useSensor(PointerSensor, POINTER_SENSOR_OPTIONS),
    useSensor(KeyboardSensor)
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      reorder(String(active.id), String(over.id));
    }
  };

  if (sortableBlocks.length === 0) {
    return (
      <p className="px-1.5 py-2 text-sm text-muted-foreground">
        <Trans>No blocks on the page</Trans>
      </p>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={sortableBlocks.map((b) => b.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-col gap-1">
          {sortableBlocks.map((block) => (
            <Fragment key={block.id}>
              <BlockRow id={block.id} />
              {block.type === "lineItems" && summaryBlock && (
                <div className="ml-3 border-l border-border/60 pl-2">
                  <StaticBlockRow id={summaryBlock.id} />
                </div>
              )}
            </Fragment>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

/**
 * Body blocks switched off. Showing one puts it back where it was in the
 * order, since hiding never moves a block.
 */
export function HiddenBlockList() {
  const hiddenBlocks = useBodyBlocks().filter((b) => !b.visible);
  return (
    <div className="flex flex-col gap-1">
      {hiddenBlocks.map((block) => (
        <StaticBlockRow key={block.id} id={block.id} />
      ))}
    </div>
  );
}

/**
 * The "Add block" menu — extracted from the (scrollable) block list so the
 * editor can pin it below the list.
 */
export function AddBlockMenu() {
  const {
    documentType,
    addBlock,
    addSharedBlock,
    addCustomFieldBlock,
    addField,
    sections,
    customFields
  } = useDocumentTemplate();
  const isTextOnly = extensionSupport(documentType) === "text";
  const bodySections = sections.filter((s) => s.placement === "body");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          aria-label="Add block"
          variant="ghost"
          size="sm"
          icon={<LuPlus />}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-[--radix-popper-anchor-width] min-w-64"
      >
        {isTextOnly ? (
          <AddMenuItem
            icon={<LuType className="size-4" />}
            title="Text field"
            description="A label and a value"
            onClick={() => addField(true)}
          />
        ) : (
          <>
            <AddMenuItem
              icon={<LuType className="size-4" />}
              title="Text field"
              description="A label and a value"
              onClick={() => addField(true)}
            />
            {ADD_OPTIONS.map(({ type, icon, description }) => (
              <AddMenuItem
                key={type}
                icon={icon}
                title={BLOCK_META[type].label}
                description={description}
                onClick={() => addBlock(type)}
              />
            ))}
          </>
        )}
        {!isTextOnly && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Shared sections</DropdownMenuLabel>
            {bodySections.map((section) => (
              <DropdownMenuItem
                key={section.id}
                onClick={() => addSharedBlock(section.id)}
                className="flex items-center gap-2.5"
              >
                <LuLibrary className="size-4 text-muted-foreground" />
                <span className="text-sm">{section.name}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem asChild className="flex items-center gap-2.5">
              <Link to={path.to.documentSections}>
                <LuPlus className="size-4 text-muted-foreground" />
                <span className="text-sm">
                  {bodySections.length > 0
                    ? "New shared section"
                    : "Create a shared section"}
                </span>
              </Link>
            </DropdownMenuItem>
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Custom fields</DropdownMenuLabel>
        {customFields.map((field) => (
          <DropdownMenuItem
            key={field.id}
            onClick={() => addCustomFieldBlock(field.id, field.name)}
            className="flex items-center gap-2.5"
          >
            <LuTag className="size-4 text-muted-foreground" />
            <span className="text-sm">{field.name}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem asChild className="flex items-center gap-2.5">
          <Link to={path.to.customFields}>
            <LuPlus className="size-4 text-muted-foreground" />
            <span className="text-sm">
              {customFields.length > 0
                ? "Manage custom fields"
                : "Create a custom field"}
            </span>
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AddMenuItem({
  icon,
  title,
  description,
  onClick
}: {
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <DropdownMenuItem
      onClick={onClick}
      className="flex items-start gap-2.5 py-2"
    >
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <span className="flex flex-col">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </span>
    </DropdownMenuItem>
  );
}

function blockLabel(
  block: DocumentBlock,
  sections: SectionRef[],
  deletedSection: string
): string {
  const meta = BLOCK_META[block.type];
  return block.type === "shared"
    ? (sections.find((s) => s.id === block.sectionId)?.name ?? deletedSection)
    : block.type === "customField"
      ? block.label || meta.label
      : block.type === "field"
        ? block.label || block.value || meta.label
        : meta.label;
}

function BlockRow({ id }: { id: string }) {
  const { t } = useLingui();
  const { blocks, sections, selectedId, toggleVisible, removeBlock } =
    useDocumentTemplate();
  const pickBlock = usePickBlock();
  const { isDocument, locked } = useDocumentModeFlags();
  const block = blocks.find((b) => b.id === id);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id, disabled: isDocument });

  if (!block) return null;
  const meta = BLOCK_META[block.type];
  const isSelected = selectedId === id;
  const shown = block.visible;
  const onToggle = () => toggleVisible(id);
  const label = blockLabel(block, sections, t`Shared Section (deleted)`);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: mouse-sized hit area only; the inner label <button> is the keyboard/AT control and its click bubbles here
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition: transition ?? undefined
      }}
      onClick={() => pickBlock(id)}
      className={cn(
        "group flex cursor-pointer items-center gap-1.5 rounded-md border px-1.5 py-2",
        "transition-colors duration-150",
        isSelected
          ? "border-primary bg-accent/50"
          : "border-transparent hover:border-border hover:bg-accent/30",
        isDragging && "opacity-50 shadow-sm",
        !shown && !isSelected && "opacity-60"
      )}
    >
      {isDocument ? (
        // One record's document keeps the template's order.
        <span className="p-1 text-muted-foreground/60">
          {blockIcon(block.type)}
        </span>
      ) : (
        <button
          type="button"
          aria-label={t`Drag to reorder`}
          onClick={(e) => e.stopPropagation()}
          className="relative cursor-grab touch-none text-muted-foreground/60 active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          {/* Type icon normally; grip on hover to signal draggability. */}
          <span className="group-hover:opacity-0 group-focus-within:opacity-0">
            {blockIcon(block.type)}
          </span>
          <span className="absolute inset-0 md:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100">
            <LuGripVertical className="size-4" />
          </span>
        </button>
      )}

      <button
        type="button"
        aria-pressed={isSelected}
        className="flex flex-1 items-center gap-2 truncate text-left text-sm"
      >
        <span className="truncate">{label}</span>
        {block.type === "shared" ? (
          <span className="rounded bg-muted px-1.5 py-px text-[0.625rem] font-medium uppercase tracking-wide text-muted-foreground">
            Shared
          </span>
        ) : (
          !meta.isBuiltIn && (
            <span className="rounded bg-muted px-1.5 py-px text-[0.625rem] font-medium uppercase tracking-wide text-muted-foreground">
              Custom
            </span>
          )
        )}
      </button>

      {meta.removable && !isDocument && (
        <button
          type="button"
          aria-label={t`Remove block`}
          onClick={(e) => {
            e.stopPropagation();
            removeBlock(id);
          }}
          className="rounded p-1 text-muted-foreground md:opacity-0 transition-[opacity,color] hover:text-destructive group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
        >
          <LuTrash2 className="size-4" />
        </button>
      )}

      {meta.hideable ? (
        <button
          type="button"
          aria-label={shown ? t`Hide block` : t`Show block`}
          aria-pressed={shown}
          disabled={locked}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className={cn(
            "rounded p-1 transition-colors",
            shown
              ? "text-foreground hover:bg-muted"
              : "text-muted-foreground hover:bg-muted"
          )}
        >
          {shown ? (
            <LuEye className="size-4" />
          ) : (
            <LuEyeOff className="size-4" />
          )}
        </button>
      ) : (
        <span
          title="Required — always shown"
          className="p-1 text-muted-foreground/50"
        >
          <LuLock className="size-3.5" />
        </span>
      )}
    </div>
  );
}

/**
 * A non-draggable block row: Summary nested under Line Items, and the rows
 * under "Not on the page". Same selection / visibility / remove behavior as
 * `BlockRow`, without the drag handle.
 */
function StaticBlockRow({ id }: { id: string }) {
  const { t } = useLingui();
  const { blocks, sections, selectedId, toggleVisible, removeBlock } =
    useDocumentTemplate();
  const pickBlock = usePickBlock();
  const { isDocument, locked } = useDocumentModeFlags();
  const block = blocks.find((b) => b.id === id);
  if (!block) return null;
  const meta = BLOCK_META[block.type];
  const isSelected = selectedId === id;
  const shown = block.visible;
  const label = blockLabel(block, sections, t`Shared Section (deleted)`);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: mouse-sized hit area only; the inner label <button> is the keyboard/AT control
    <div
      onClick={() => pickBlock(id)}
      className={cn(
        "group flex cursor-pointer items-center gap-1.5 rounded-md border px-1.5 py-2",
        "transition-colors duration-150",
        isSelected
          ? "border-primary bg-accent/50"
          : "border-transparent hover:border-border hover:bg-accent/30",
        !shown && !isSelected && "opacity-60"
      )}
    >
      <span className="p-1 text-muted-foreground/60">
        {blockIcon(block.type)}
      </span>
      <button
        type="button"
        aria-pressed={isSelected}
        className="flex-1 truncate text-left text-sm"
      >
        {label}
      </button>
      {meta.removable && !isDocument && (
        <button
          type="button"
          aria-label={t`Remove block`}
          onClick={(e) => {
            e.stopPropagation();
            removeBlock(id);
          }}
          className="rounded p-1 text-muted-foreground md:opacity-0 transition-[opacity,color] hover:text-destructive group-hover:opacity-100"
        >
          <LuTrash2 className="size-4" />
        </button>
      )}
      {meta.hideable ? (
        <button
          type="button"
          aria-label={shown ? t`Hide block` : t`Show block`}
          aria-pressed={shown}
          disabled={locked}
          onClick={(e) => {
            e.stopPropagation();
            toggleVisible(id);
          }}
          className={cn(
            "rounded p-1 transition-colors",
            shown
              ? "text-foreground hover:bg-muted"
              : "text-muted-foreground hover:bg-muted"
          )}
        >
          {shown ? (
            <LuEye className="size-4" />
          ) : (
            <LuEyeOff className="size-4" />
          )}
        </button>
      ) : (
        <span
          title="Required — always shown"
          className="p-1 text-muted-foreground/50"
        >
          <LuLock className="size-3.5" />
        </span>
      )}
    </div>
  );
}

/**
 * The page Header — pinned (not reorderable). Eye toggles it on/off; selecting
 * it opens the header config (a link to its global shared section).
 */
function HeaderRow({ id }: { id: string }) {
  const { selectedId, headerSectionId, setHeaderSection } =
    useDocumentTemplate();
  const pickBlock = usePickBlock();
  const isSelected = selectedId === id;
  const shown = headerSectionId !== null;

  return (
    <ChromeRow
      icon={<LuPanelTop className="size-4" />}
      label="Header"
      isSelected={isSelected}
      shown={shown}
      onSelect={() => pickBlock(id)}
      onToggle={() =>
        setHeaderSection(shown ? null : BUILT_IN_SECTION_IDS.header)
      }
    />
  );
}

/**
 * The Logo — a child of the Header, shown indented in the tree so it can be
 * configured inline (variant, crop, height) instead of via the header dialog.
 * Only rendered while the header is shown. Eye toggles `showLogo`.
 */
function HeaderLogoRow() {
  const { selectedId, headerSectionId } = useDocumentTemplate();
  const pickBlock = usePickBlock();
  const { section, config, patch } = useHeaderConfig();
  const { isDocument } = useDocumentModeFlags();
  // Hide the node when the header is off or its section isn't available. The
  // logo is company-wide, so one record's document does not show it.
  if (!section || headerSectionId === null || isDocument) return null;
  const isSelected = selectedId === HEADER_LOGO_ID;
  const shown = config.showLogo;

  return (
    <div className="ml-3 border-l border-border/60 pl-2">
      {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: mouse-sized hit area only; the inner label <button> is the keyboard/AT control and its click bubbles here */}
      <div
        onClick={() => pickBlock(HEADER_LOGO_ID)}
        className={cn(
          "group flex cursor-pointer items-center gap-1.5 rounded-md border px-1.5 py-2",
          "transition-colors duration-150",
          isSelected
            ? "border-primary bg-accent/50"
            : "border-transparent hover:border-border hover:bg-accent/30",
          !shown && !isSelected && "opacity-60"
        )}
      >
        <span className="p-1 text-muted-foreground/40">
          <LuImage className="size-4" />
        </span>
        <button
          type="button"
          aria-pressed={isSelected}
          className="flex-1 truncate text-left text-sm"
        >
          Logo
        </button>
        <button
          type="button"
          aria-label={shown ? "Hide logo" : "Show logo"}
          aria-pressed={shown}
          onClick={(e) => {
            e.stopPropagation();
            patch({ showLogo: !shown });
          }}
          className={cn(
            "rounded p-1 transition-colors",
            shown
              ? "text-foreground hover:bg-muted"
              : "text-muted-foreground hover:bg-muted"
          )}
        >
          {shown ? (
            <LuEye className="size-4" />
          ) : (
            <LuEyeOff className="size-4" />
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * The page Footer — chrome, not a flow block, so it's a static row pinned below
 * the sortable blocks. Eye toggles the footer on/off; selecting it opens the
 * footer config (page numbers, registration line).
 */
export function FooterRow() {
  const { footerSectionId, setFooterSection, selectedId } =
    useDocumentTemplate();
  const pickBlock = usePickBlock();
  const isSelected = selectedId === FOOTER_BLOCK_ID;
  const shown = footerSectionId !== null;

  return (
    <ChromeRow
      icon={<LuPanelBottom className="size-4" />}
      label="Footer"
      isSelected={isSelected}
      shown={shown}
      onSelect={() => pickBlock(FOOTER_BLOCK_ID)}
      onToggle={() =>
        setFooterSection(shown ? null : BUILT_IN_SECTION_IDS.footer)
      }
    />
  );
}

/** Shared presentation for the pinned, non-draggable Header & Footer rows. */
function ChromeRow({
  icon,
  label,
  isSelected,
  shown,
  onSelect,
  onToggle
}: {
  icon: ReactNode;
  label: string;
  isSelected: boolean;
  shown: boolean;
  onSelect: () => void;
  onToggle: () => void;
}) {
  const { isDocument } = useDocumentModeFlags();
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: mouse-sized hit area only; the inner label <button> is the keyboard/AT control and its click bubbles here
    <div
      onClick={onSelect}
      className={cn(
        "group flex cursor-pointer items-center gap-1.5 rounded-md border px-1.5 py-2",
        "transition-colors duration-150",
        isSelected
          ? "border-primary bg-accent/50"
          : "border-transparent hover:border-border hover:bg-accent/30",
        !shown && !isSelected && "opacity-60"
      )}
    >
      <span className="p-1 text-muted-foreground/40">{icon}</span>
      <button
        type="button"
        aria-pressed={isSelected}
        className="flex-1 truncate text-left text-sm"
      >
        {label}
      </button>
      <button
        type="button"
        hidden={isDocument}
        aria-label={shown ? `Hide ${label}` : `Show ${label}`}
        aria-pressed={shown}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className={cn(
          "rounded p-1 transition-colors",
          shown
            ? "text-foreground hover:bg-muted"
            : "text-muted-foreground hover:bg-muted"
        )}
      >
        {shown ? <LuEye className="size-4" /> : <LuEyeOff className="size-4" />}
      </button>
    </div>
  );
}
