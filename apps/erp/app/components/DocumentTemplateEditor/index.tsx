// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
  cn,
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
  Subheading,
  useViewport
} from "@carbon/react";
import { labelSizes } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useState } from "react";
import { LuArrowLeft, LuRefreshCw } from "react-icons/lu";
import { Link } from "react-router";
import { CompactTabRow } from "~/components/Layout/CompactTabRow";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { BlockConfig } from "./BlockConfig";
import {
  AddBlockMenu,
  BodyBlockList,
  FooterRow,
  HiddenBlockList,
  PageTopRows,
  useHiddenBlockCount
} from "./BlockList";
import type { CustomFieldRef, PreviewEntity, SectionRef } from "./context";
import {
  DocumentTemplateProvider,
  PickBlockProvider,
  useDocumentTemplate,
  useEditorStore,
  useIsDirty,
  useLoadPrintedValues
} from "./context";
import { FontConfig } from "./FontConfig";
import { RememberedSection } from "./PanelSection";
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
      <div className="flex h-full w-full min-w-0 flex-col bg-background max-md:h-[calc(100dvh-var(--topbar-height)-var(--content-inset,0px))]">
        <EditorToolbar
          title={getDocumentLabel(documentType)}
          canEdit={canEdit}
        />
        <ConflictBanner documentType={documentType} />
        <TemplateValuesLoader actionPath={actionPath} />
        <EditorPanes actionPath={actionPath} />
      </div>
    </DocumentTemplateProvider>
  );
}

/** The values of the sample or the picked record, for a click on the preview. */
function TemplateValuesLoader({ actionPath }: { actionPath: string }) {
  const previewId = useEditorStore((s) => s.previewId);
  useLoadPrintedValues(
    `${actionPath}/values${previewId ? `?previewId=${encodeURIComponent(previewId)}` : ""}`
  );
  return null;
}

/**
 * Desktop: rail / canvas / config side by side. Phones: one pane at a time
 * behind an underline tab row (the record-tabs pattern).
 */
export function EditorPanes({ actionPath }: { actionPath: string }) {
  const { isPhone } = useViewport();
  if (isPhone) return <CompactEditorPanes actionPath={actionPath} />;

  return (
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
            <Subheading as="h2" variant="heavy" className="block">
              <Trans>Configure</Trans>
            </Subheading>
            <BlockConfig />
          </div>
        </ScrollArea>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

type CompactPane = "canvas" | "rail" | "config";

function CompactEditorPanes({ actionPath }: { actionPath: string }) {
  const { t } = useLingui();
  const selectedId = useEditorStore((s) => s.selectedId);
  const select = useEditorStore((s) => s.select);
  const [pane, setPane] = useState<CompactPane>("canvas");

  const textFocus = useEditorStore((s) => s.textFocus);
  // A newly added block, or a word clicked in the preview, opens its
  // settings, as the desktop config rail does.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `textFocus` changes on every click in the preview, even on the selected block.
  useEffect(() => {
    if (selectedId) setPane("config");
  }, [selectedId, textFocus]);
  // Tapping a row always opens its settings: the config sits on another tab,
  // so a second tap must not deselect it.
  const pickBlock = useCallback(
    (id: string) => {
      select(id);
      setPane("config");
    },
    [select]
  );

  const tabs: { id: CompactPane; label: string }[] = [
    { id: "canvas", label: t`Preview` },
    { id: "rail", label: t`Blocks` },
    { id: "config", label: t`Configure` }
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CompactTabRow
        items={tabs.map((tab) => ({
          ...tab,
          active: pane === tab.id,
          onClick: () => setPane(tab.id)
        }))}
      />
      {/* Panes stay mounted (hidden) so the preview keeps its state. */}
      <div className="relative min-h-0 flex-1">
        <div
          className={cn(
            "absolute inset-0 flex flex-col bg-muted/40 p-4",
            pane !== "canvas" && "hidden"
          )}
        >
          <TemplatePreview previewPath={`${actionPath}/preview`} />
        </div>
        <div className={cn("absolute inset-0", pane !== "rail" && "hidden")}>
          <PickBlockProvider value={pickBlock}>
            <ControlRail />
          </PickBlockProvider>
        </div>
        <div className={cn("absolute inset-0", pane !== "config" && "hidden")}>
          <ScrollArea className="h-full bg-card">
            <div className="flex flex-col gap-1.5 p-4">
              <BlockConfig />
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}

/** Sentinel option for the preview picker — falls back to sample data. */
const SAMPLE_DATA_VALUE = "__sample__";

/**
 * Left rail: where blocks sit on the page (top, body, bottom), the blocks
 * switched off, then the document's font and colors. Every section folds, and
 * stays as the user left it.
 */
function ControlRail() {
  const { t } = useLingui();
  const documentType = useEditorStore((s) => s.documentType);
  const hiddenCount = useHiddenBlockCount();
  // One record's document keeps the template's blocks, font and colors.
  const isDocument = useEditorStore((s) => s.document !== null);
  // Labels print on thermal stock with fixed printer fonts and no page chrome.
  const isLabel = documentType === "trackingLabel";
  // Only show Colors when the document actually uses theme colors.
  const showColors = hasThemeColors(documentType);

  return (
    <ScrollArea className="h-full bg-card">
      <div className="flex flex-col">
        {!isLabel && (
          <RememberedSection id="rail:top" title={t`Top of page`}>
            <PageTopRows />
          </RememberedSection>
        )}
        <RememberedSection
          id="rail:body"
          title={isLabel ? t`Blocks` : t`Body`}
          action={isDocument ? undefined : <AddBlockMenu />}
        >
          <BodyBlockList />
        </RememberedSection>
        {!isLabel && (
          <RememberedSection id="rail:bottom" title={t`Footer`}>
            <FooterRow />
          </RememberedSection>
        )}
        {hiddenCount > 0 && (
          <RememberedSection
            id="rail:hidden"
            defaultOpen={false}
            title={t`Not on the page`}
            count={hiddenCount}
          >
            <HiddenBlockList />
          </RememberedSection>
        )}
        {!isLabel && !isDocument && (
          <RememberedSection id="rail:font" defaultOpen={false} title={t`Font`}>
            <FontConfig />
          </RememberedSection>
        )}
        {!isLabel && showColors && !isDocument && (
          <RememberedSection
            id="rail:colors"
            defaultOpen={false}
            title={t`Colors`}
          >
            <ThemeConfig />
          </RememberedSection>
        )}
      </div>
    </ScrollArea>
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
        <Trans>
          Someone else just saved this template. Refresh to load their version,
          or keep editing to overwrite it when you save.
        </Trans>
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="secondary" size="sm" onClick={dismiss}>
          <Trans>Keep mine</Trans>
        </Button>
        <Button size="sm" onClick={() => window.location.reload()}>
          <Trans>Refresh</Trans>
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
  // A draft printed on a real record needs update rights (`$type.preview`).
  const canPreviewRecords = usePermissions().can("update", "settings");
  const { t } = useLingui();
  const isDirty = useIsDirty();
  const { isSaving, reset, save, previewEntities, previewId, setPreviewId } =
    useDocumentTemplate();
  const refreshPreview = useEditorStore((s) => s.refreshPreview);

  return (
    <div className="flex min-h-12 items-center gap-3 border-b bg-card px-3 py-2 max-md:flex-wrap max-md:gap-2">
      <Link
        to={path.to.documentTemplates}
        aria-label={t`Back to documents`}
        className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground max-md:hidden"
      >
        <LuArrowLeft className="size-4" />
      </Link>
      <div className="flex min-w-0 flex-col">
        <h1 className="truncate text-sm font-semibold">{title}</h1>
        <p className="truncate text-xs text-muted-foreground">
          <Trans>Document template</Trans>
        </p>
      </div>
      <div className="flex-1 max-md:hidden" />
      <div className="flex items-center gap-2 max-md:order-last max-md:basis-full">
        {canPreviewRecords && previewEntities.length > 0 && (
          <Select
            value={previewId ?? SAMPLE_DATA_VALUE}
            onValueChange={(value) =>
              setPreviewId(value === SAMPLE_DATA_VALUE ? null : value)
            }
          >
            <SelectTrigger
              size="sm"
              aria-label={t`Preview with`}
              className="w-auto min-w-48 gap-1.5 max-md:flex-1"
            >
              <span className="shrink-0 text-muted-foreground">
                <Trans>Preview with</Trans>
              </span>
              <SelectValue placeholder={t`Sample data`} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SAMPLE_DATA_VALUE}>
                <Trans>Sample data</Trans>
              </SelectItem>
              {previewEntities.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <LabelSizePicker />
      </div>
      {canEdit && (
        <div className="flex items-center gap-1.5 max-md:ml-auto">
          <IconButton
            aria-label={t`Refresh preview`}
            variant="ghost"
            icon={<LuRefreshCw />}
            onClick={refreshPreview}
          />
          <Button
            variant="ghost"
            onClick={reset}
            isDisabled={!isDirty || isSaving}
          >
            <Trans>Discard</Trans>
          </Button>
          <Button onClick={save} isLoading={isSaving} isDisabled={!isDirty}>
            <Trans>Save</Trans>
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Label stock picker (tracking-label only). Preview-only — the layout scales to
 * any size, so this just drives which stock the preview renders against;
 * seeded from the company's configured label size.
 */
function LabelSizePicker() {
  const { t } = useLingui();
  const documentType = useEditorStore((s) => s.documentType);
  const labelSizeId = useEditorStore((s) => s.labelSizeId);
  const setLabelSizeId = useEditorStore((s) => s.setLabelSizeId);
  if (documentType !== "trackingLabel") return null;

  return (
    <Select value={labelSizeId} onValueChange={setLabelSizeId}>
      <SelectTrigger
        size="sm"
        aria-label={t`Label size`}
        className="w-auto min-w-40 gap-1.5"
      >
        <span className="shrink-0 text-muted-foreground">
          <Trans>Size</Trans>
        </span>
        <SelectValue placeholder={t`Label size`} />
      </SelectTrigger>
      <SelectContent>
        {labelSizes.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
