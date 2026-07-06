import type {
  DocumentBlock,
  DocumentSettings,
  DocumentTemplateType,
  DocumentTheme
} from "@carbon/documents/template";
import { getDocumentLabel } from "@carbon/documents/template";
import type { JSONContent } from "@carbon/react";
import {
  Button,
  Heading,
  IconButton,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from "@carbon/react";
import { labelSizes } from "@carbon/utils";
import { type ReactNode, useState } from "react";
import { LuArrowLeft, LuPalette, LuRefreshCw, LuType } from "react-icons/lu";
import { Link } from "react-router";
import { path } from "~/utils/path";
import { BlockConfig } from "./BlockConfig";
import { AddBlockMenu, BlockList } from "./BlockList";
import type { CustomFieldRef, PreviewEntity, SectionRef } from "./context";
import {
  DocumentTemplateProvider,
  useDocumentTemplate,
  useEditorStore
} from "./context";
import { FontConfig } from "./FontConfig";
import { TemplatePreview } from "./TemplatePreview";
import { hasThemeColors, ThemeConfig } from "./ThemeConfig";
import { useTemplateConflict } from "./useTemplateConflict";

export function DocumentTemplateEditor({
  documentType,
  actionPath,
  initialBlocks,
  initialTheme,
  initialSettings,
  initialHeaderSectionId,
  initialFooterSectionId,
  sections,
  customFields,
  previewEntities,
  termsSeed,
  hasWatermark,
  initialLabelSizeId,
  canEdit
}: {
  documentType: DocumentTemplateType;
  actionPath: string;
  initialBlocks: DocumentBlock[];
  initialTheme: DocumentTheme;
  initialSettings: DocumentSettings;
  initialHeaderSectionId: string | null;
  initialFooterSectionId: string | null;
  sections: SectionRef[];
  customFields: CustomFieldRef[];
  previewEntities: PreviewEntity[];
  termsSeed?: JSONContent;
  hasWatermark: boolean;
  initialLabelSizeId?: string;
  canEdit: boolean;
}) {
  return (
    <DocumentTemplateProvider
      documentType={documentType}
      actionPath={actionPath}
      initialBlocks={initialBlocks}
      initialTheme={initialTheme}
      initialSettings={initialSettings}
      initialHeaderSectionId={initialHeaderSectionId}
      initialFooterSectionId={initialFooterSectionId}
      sections={sections}
      customFields={customFields}
      previewEntities={previewEntities}
      termsSeed={termsSeed}
      hasWatermark={hasWatermark}
      initialLabelSizeId={initialLabelSizeId}
    >
      <div className="flex h-full w-full min-w-0 flex-col bg-background">
        <EditorToolbar
          title={getDocumentLabel(documentType)}
          canEdit={canEdit}
        />
        <ConflictBanner documentType={documentType} />
        <ResizablePanelGroup
          direction="horizontal"
          autoSaveId="document-template-editor"
          className="flex-1 overflow-hidden"
        >
          {/* LEFT — blocks + theme */}
          <ResizablePanel
            id="rail"
            order={1}
            defaultSize={22}
            minSize={16}
            maxSize={34}
          >
            <ControlRail />
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* CENTER — canvas */}
          <ResizablePanel id="canvas" order={2} defaultSize={56} minSize={30}>
            <div className="flex h-full min-w-0 flex-col bg-muted/40 p-6">
              <TemplatePreview previewPath={`${actionPath}/preview`} />
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* RIGHT — contextual config, always present */}
          <ResizablePanel
            id="config"
            order={3}
            defaultSize={22}
            minSize={16}
            maxSize={34}
          >
            <ScrollArea className="h-full bg-card">
              <div className="flex flex-col gap-1.5 p-3">
                <h2 className={RAIL_HEADING}>Configure</h2>
                <BlockConfig />
              </div>
            </ScrollArea>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </DocumentTemplateProvider>
  );
}

const RAIL_HEADING =
  "text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

/** Sentinel option for the preview picker — falls back to sample data. */
const SAMPLE_DATA_VALUE = "__sample__";

/** Tiny caption above a toolbar picker. */
const PICKER_LABEL =
  "text-[10px] font-medium uppercase tracking-wide text-muted-foreground";

/**
 * Left rail: block layers (incl. the Header block + Footer row) and a tab group
 * for document-wide Style (typography) and Colors. The contextual Configure
 * panel lives in its own right rail.
 */
function ControlRail() {
  const [tab, setTab] = useState<"style" | "colors">("style");
  const documentType = useEditorStore((s) => s.documentType);
  // Labels render on thermal stock with fixed printer fonts — no style tab.
  const isLabel = documentType === "trackingLabel";
  // Only show Colors when the document actually uses theme colors.
  const showColors = hasThemeColors(documentType);

  return (
    <div className="flex h-full flex-col bg-card">
      {/* Fixed Blocks header with the inline add-block button. */}
      <div className="flex shrink-0 items-center justify-between px-3 pt-3 pb-1">
        <h2 className={RAIL_HEADING}>Blocks</h2>
        <AddBlockMenu />
      </div>

      {/* Block rows — capped at half the panel, scrolling past that. */}
      <div className="min-h-0 max-h-[50%]">
        <ScrollArea className="h-full">
          <div className="px-3 pb-1">
            <BlockList />
          </div>
        </ScrollArea>
      </div>

      {!isLabel && (
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as "style" | "colors")}
          className="flex shrink-0 flex-col border-t"
        >
          <TabsList className="h-auto w-full justify-start gap-1 rounded-none border-b bg-transparent p-0 px-3 shadow-none">
            <UnderlineTab value="style" icon={<LuType />} label="Style" />
            {showColors && (
              <UnderlineTab
                value="colors"
                icon={<LuPalette />}
                label="Colors"
              />
            )}
          </TabsList>
          {/* Tab body scrolls within a bounded height so it never starves the
              blocks list above. */}
          <ScrollArea className="max-h-[45vh]">
            <TabsContent value="style" className="flex flex-col gap-5 p-3 pt-4">
              <section className="flex flex-col gap-3">
                <h3 className={RAIL_HEADING}>Typography</h3>
                <FontConfig />
              </section>
            </TabsContent>
            {showColors && (
              <TabsContent
                value="colors"
                className="flex flex-col gap-5 p-3 pt-4"
              >
                <section className="flex flex-col gap-2">
                  <h3 className={RAIL_HEADING}>Theme colors</h3>
                  <ThemeConfig />
                </section>
              </TabsContent>
            )}
          </ScrollArea>
        </Tabs>
      )}
    </div>
  );
}

/** Clean underline-style tab trigger with a generous hit area. */
function UnderlineTab({
  value,
  icon,
  label
}: {
  value: string;
  icon: ReactNode;
  label: string;
}) {
  return (
    <TabsTrigger
      value={value}
      className="-mb-px gap-1.5 rounded-none border-0 border-b-2 border-transparent bg-transparent px-3 py-2 text-xs text-muted-foreground shadow-none data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
    >
      <span className="[&>svg]:size-3.5">{icon}</span>
      {label}
    </TabsTrigger>
  );
}

/**
 * Realtime warning shown when another user saves this template while it's open.
 * The editor never auto-reloads (that would discard in-progress edits) — the
 * user chooses to refresh to their version or keep editing (overwrite on save).
 */
function ConflictBanner({
  documentType
}: {
  documentType: DocumentTemplateType;
}) {
  const { conflict, dismiss } = useTemplateConflict(documentType);
  if (!conflict) return null;

  return (
    <div className="flex items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2">
      <p className="text-sm text-amber-700 dark:text-amber-400">
        Someone else just saved this template. Refresh to load their version, or
        keep editing to overwrite it when you save.
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="secondary" size="sm" onClick={dismiss}>
          Keep mine
        </Button>
        <Button size="sm" onClick={() => window.location.reload()}>
          Refresh
        </Button>
      </div>
    </div>
  );
}

function EditorToolbar({
  title,
  canEdit
}: {
  title: string;
  canEdit: boolean;
}) {
  const {
    isDirty,
    isSaving,
    reset,
    save,
    previewEntities,
    previewId,
    setPreviewId
  } = useDocumentTemplate();
  const refreshPreview = useEditorStore((s) => s.refreshPreview);

  return (
    <div className="flex items-center justify-between gap-3 border-b bg-card px-4 py-3">
      <div className="flex items-center gap-3">
        <Link
          to={path.to.documentTemplates}
          aria-label="Back to documents"
          className="flex size-8 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <LuArrowLeft className="size-4" />
        </Link>
        <div className="flex flex-col">
          <Heading size="h4">Document Layout</Heading>
          <p className="text-xs text-muted-foreground">{title}</p>
        </div>
      </div>
      {previewEntities.length > 0 && (
        <div className="flex min-w-0 max-w-[280px] flex-1 flex-col items-center gap-0.5 self-end">
          <span className={PICKER_LABEL}>Preview data</span>
          <Select
            value={previewId ?? SAMPLE_DATA_VALUE}
            onValueChange={(value) =>
              setPreviewId(value === SAMPLE_DATA_VALUE ? null : value)
            }
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue placeholder="Sample data" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SAMPLE_DATA_VALUE}>Sample data</SelectItem>
              {previewEntities.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="flex items-end gap-2">
        <LabelSizePicker />
        {canEdit && (
          <>
            <IconButton
              aria-label="Refresh preview"
              variant="secondary"
              icon={<LuRefreshCw />}
              onClick={refreshPreview}
            />
            <Button
              variant="secondary"
              onClick={reset}
              isDisabled={!isDirty || isSaving}
            >
              Discard
            </Button>
            <Button onClick={save} isLoading={isSaving} isDisabled={!isDirty}>
              Save layout
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Label stock picker (tracking-label only). Preview-only — the layout scales to
 * any size, so this just drives which stock the preview renders against;
 * seeded from the company's configured label size.
 */
function LabelSizePicker() {
  const documentType = useEditorStore((s) => s.documentType);
  const labelSizeId = useEditorStore((s) => s.labelSizeId);
  const setLabelSizeId = useEditorStore((s) => s.setLabelSizeId);
  if (documentType !== "trackingLabel") return null;

  return (
    <div className="flex flex-col items-start gap-0.5">
      <span className={PICKER_LABEL}>Preview size</span>
      <Select value={labelSizeId} onValueChange={setLabelSizeId}>
        <SelectTrigger size="sm" className="w-[160px]">
          <SelectValue placeholder="Label size" />
        </SelectTrigger>
        <SelectContent>
          {labelSizes.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
