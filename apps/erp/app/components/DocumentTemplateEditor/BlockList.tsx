import type { DocumentBlockType } from "@carbon/documents/template";
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
import { path } from "~/utils/path";
import {
  type AddableBlockType,
  FOOTER_BLOCK_ID,
  useDocumentTemplate
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

export function BlockList() {
  const { documentType, blocks, reorder } = useDocumentTemplate();
  // Labels have no page chrome — no footer row.
  const isLabel = documentType === "trackingLabel";
  // Header & footer are page chrome — pinned (not reorderable). Only the body
  // blocks between them are sortable.
  const headerBlock = blocks.find((b) => b.type === "header");
  const bodyBlocks = blocks.filter((b) => b.type !== "header");
  // The Summary (totals) belongs to the Line Items table, so it's shown nested
  // under it in the tree rather than as a separate sortable row. Only nest when
  // a Line Items block is actually present.
  const hasLineItems = bodyBlocks.some((b) => b.type === "lineItems");
  const summaryBlock = hasLineItems
    ? bodyBlocks.find((b) => b.type === "summary")
    : undefined;
  const sortableBlocks = summaryBlock
    ? bodyBlocks.filter((b) => b.id !== summaryBlock.id)
    : bodyBlocks;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      reorder(String(active.id), String(over.id));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        {headerBlock && <HeaderRow id={headerBlock.id} />}
        {headerBlock && <HeaderLogoRow />}
      </div>
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
                  <NestedBlockRow id={summaryBlock.id} />
                )}
              </Fragment>
            ))}
            {!isLabel && <FooterRow />}
          </div>
        </SortableContext>
      </DndContext>
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

function BlockRow({ id }: { id: string }) {
  const { blocks, sections, selectedId, select, toggleVisible, removeBlock } =
    useDocumentTemplate();
  const block = blocks.find((b) => b.id === id);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id });

  if (!block) return null;
  const meta = BLOCK_META[block.type];
  const isSelected = selectedId === id;
  const shown = block.visible;
  const onToggle = () => toggleVisible(id);
  const label =
    block.type === "shared"
      ? (sections.find((s) => s.id === block.sectionId)?.name ??
        "Shared Section (deleted)")
      : block.type === "customField"
        ? block.label || meta.label
        : block.type === "field"
          ? block.label || block.value || meta.label
          : meta.label;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition: transition ?? undefined
      }}
      onClick={() => select(isSelected ? null : id)}
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
      <button
        type="button"
        aria-label="Drag to reorder"
        onClick={(e) => e.stopPropagation()}
        className="relative cursor-grab text-muted-foreground/60 active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        {/* Type icon normally; grip on hover to signal draggability. */}
        <span className="group-hover:opacity-0">{blockIcon(block.type)}</span>
        <span className="absolute inset-0 opacity-0 group-hover:opacity-100">
          <LuGripVertical className="size-4" />
        </span>
      </button>

      <span className="flex flex-1 items-center gap-2 truncate text-sm">
        <span className="truncate">{label}</span>
        {block.type === "shared" ? (
          <span className="rounded bg-muted px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Shared
          </span>
        ) : (
          !meta.isBuiltIn && (
            <span className="rounded bg-muted px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Custom
            </span>
          )
        )}
      </span>

      {meta.removable && (
        <button
          type="button"
          aria-label="Remove block"
          onClick={(e) => {
            e.stopPropagation();
            removeBlock(id);
          }}
          className="rounded p-1 text-muted-foreground opacity-0 transition-[opacity,color] hover:text-destructive group-hover:opacity-100"
        >
          <LuTrash2 className="size-4" />
        </button>
      )}

      {meta.hideable ? (
        <button
          type="button"
          aria-label={shown ? "Hide block" : "Show block"}
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
 * A non-draggable, indented block row — used for blocks shown nested under a
 * parent (e.g. Summary under Line Items). Same selection / visibility / remove
 * behavior as `BlockRow`, just without the drag handle.
 */
function NestedBlockRow({ id }: { id: string }) {
  const { blocks, sections, selectedId, select, toggleVisible, removeBlock } =
    useDocumentTemplate();
  const block = blocks.find((b) => b.id === id);
  if (!block) return null;
  const meta = BLOCK_META[block.type];
  const isSelected = selectedId === id;
  const shown = block.visible;
  const label =
    block.type === "shared"
      ? (sections.find((s) => s.id === block.sectionId)?.name ??
        "Shared Section (deleted)")
      : block.type === "customField"
        ? block.label || meta.label
        : block.type === "field"
          ? block.label || block.value || meta.label
          : meta.label;

  return (
    <div className="ml-3 border-l border-border/60 pl-2">
      <div
        onClick={() => select(isSelected ? null : id)}
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
        <span className="flex-1 truncate text-sm">{label}</span>
        {meta.removable && (
          <button
            type="button"
            aria-label="Remove block"
            onClick={(e) => {
              e.stopPropagation();
              removeBlock(id);
            }}
            className="rounded p-1 text-muted-foreground opacity-0 transition-[opacity,color] hover:text-destructive group-hover:opacity-100"
          >
            <LuTrash2 className="size-4" />
          </button>
        )}
        {meta.hideable ? (
          <button
            type="button"
            aria-label={shown ? "Hide block" : "Show block"}
            aria-pressed={shown}
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
    </div>
  );
}

/**
 * The page Header — pinned (not reorderable). Eye toggles it on/off; selecting
 * it opens the header config (a link to its global shared section).
 */
function HeaderRow({ id }: { id: string }) {
  const { selectedId, select, headerSectionId, setHeaderSection } =
    useDocumentTemplate();
  const isSelected = selectedId === id;
  const shown = headerSectionId !== null;

  return (
    <ChromeRow
      icon={<LuPanelTop className="size-4" />}
      label="Header"
      isSelected={isSelected}
      shown={shown}
      onSelect={() => select(isSelected ? null : id)}
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
  const { selectedId, select, headerSectionId } = useDocumentTemplate();
  const { section, config, patch } = useHeaderConfig();
  // Hide the node when the header is off or its section isn't available.
  if (!section || headerSectionId === null) return null;
  const isSelected = selectedId === HEADER_LOGO_ID;
  const shown = config.showLogo;

  return (
    <div className="ml-3 border-l border-border/60 pl-2">
      <div
        onClick={() => select(isSelected ? null : HEADER_LOGO_ID)}
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
        <span className="flex-1 truncate text-sm">Logo</span>
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
function FooterRow() {
  const { footerSectionId, setFooterSection, selectedId, select } =
    useDocumentTemplate();
  const isSelected = selectedId === FOOTER_BLOCK_ID;
  const shown = footerSectionId !== null;

  return (
    <ChromeRow
      icon={<LuPanelBottom className="size-4" />}
      label="Footer"
      isSelected={isSelected}
      shown={shown}
      onSelect={() => select(isSelected ? null : FOOTER_BLOCK_ID)}
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
  return (
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
      <span className="flex flex-1 items-center gap-2 truncate text-sm">
        <span className="truncate">{label}</span>
        <span className="rounded bg-muted px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Page
        </span>
      </span>
      <button
        type="button"
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
