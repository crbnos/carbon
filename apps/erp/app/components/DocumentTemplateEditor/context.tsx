import {
  BUILT_IN_SECTION_IDS,
  DEFAULT_HEADER_OPTIONS,
  type DocumentBlock,
  type DocumentBlockType,
  type DocumentSettings,
  type DocumentTemplateType,
  type DocumentTheme,
  type HeaderOptions
} from "@carbon/documents/template";
import type { JSONContent } from "@carbon/react";
import { arrayMove } from "@dnd-kit/sortable";
import { nanoid } from "nanoid";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef
} from "react";
import { useFetcher } from "react-router";
import type { StoreApi } from "zustand";
import { createStore, useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";

export type AddableBlockType = Extract<
  DocumentBlockType,
  "richText" | "keyValue" | "spacer"
>;

export interface SectionRef {
  id: string;
  name: string;
  placement: "body" | "header" | "footer";
  /** Present for header/footer so the editor can open the edit dialog inline. */
  content?: JSONContent;
  config?: Partial<HeaderOptions>;
}

/**
 * Synthetic selection id for the page Footer. The footer is page chrome, not a
 * flow block, so it isn't in `blocks` — but it gets a row in the list and a
 * config panel keyed off this id.
 */
export const FOOTER_BLOCK_ID = "__footer__";

/** A custom field available to insert (id + display name). */
export interface CustomFieldRef {
  id: string;
  name: string;
}

/** A real record the preview can render against (id + readable label). */
export interface PreviewEntity {
  id: string;
  label: string;
}

/** The persisted shape — what `isDirty` compares and what `save` writes. */
interface EditorSnapshot {
  blocks: DocumentBlock[];
  theme: DocumentTheme;
  settings: DocumentSettings;
  headerSectionId: string | null;
  footerSectionId: string | null;
  /**
   * Live header layout config (logo variant/crop/height, which fields show).
   * Backed by the company-global header section, but edited inline here and
   * persisted on Save — not autosaved — so it participates in `isDirty`.
   */
  headerConfig: HeaderOptions;
}

interface EditorState extends EditorSnapshot {
  // immutable context (from the loader)
  documentType: DocumentTemplateType;
  /** All shared sections available to reference (id, name, placement). */
  sections: SectionRef[];
  /** Custom fields available to insert as blocks. */
  customFields: CustomFieldRef[];
  /** Company terms setting — seeds the Terms block when it has no content. */
  termsSeed?: JSONContent;
  /** Real records the preview can render against. */
  previewEntities: PreviewEntity[];
  /** Whether the company has a watermark logo set (gates the watermark toggle). */
  hasWatermark: boolean;
  // ui state
  selectedId: string | null;
  /** Selected record id for live-data preview (null = sample data). */
  previewId: string | null;
  /** Bumped to force the preview to re-render on demand (manual refresh). */
  previewNonce: number;
  /**
   * Label stock to preview against (tracking-label only). Preview-only — the
   * layout is size-agnostic and scaled by the renderer, so this isn't persisted
   * with the template.
   */
  labelSizeId: string;
  /** Snapshot of the last-saved state; drives `isDirty` and `reset`. */
  baseline: EditorSnapshot;
  // actions
  select: (id: string | null) => void;
  setPreviewId: (id: string | null) => void;
  /** Force a fresh preview render without changing any template state. */
  refreshPreview: () => void;
  setLabelSizeId: (id: string) => void;
  addBlock: (type: AddableBlockType) => void;
  addSharedBlock: (sectionId: string) => void;
  addCustomFieldBlock: (fieldId: string, label: string) => void;
  /** Add a single-line field. `withLabel` seeds an empty label (key-value). */
  addField: (withLabel: boolean) => void;
  removeBlock: (id: string) => void;
  toggleVisible: (id: string) => void;
  reorder: (activeId: string, overId: string) => void;
  updateBlock: (id: string, patch: Partial<DocumentBlock>) => void;
  setThemeColor: (key: keyof DocumentTheme, value: string) => void;
  setSetting: <K extends keyof DocumentSettings>(
    key: K,
    value: DocumentSettings[K]
  ) => void;
  setHeaderSection: (sectionId: string | null) => void;
  setFooterSection: (sectionId: string | null) => void;
  setHeaderConfig: (patch: Partial<HeaderOptions>) => void;
  reset: () => void;
  /** Mark the current state as saved (clears `isDirty`). */
  rebaseline: () => void;
}

export interface DocumentTemplateProps {
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
  /** Company's configured label stock (tracking-label only); seeds the picker. */
  initialLabelSizeId?: string;
}

function snapshot(s: EditorSnapshot): EditorSnapshot {
  return {
    blocks: s.blocks,
    theme: s.theme,
    settings: s.settings,
    headerSectionId: s.headerSectionId,
    footerSectionId: s.footerSectionId,
    headerConfig: s.headerConfig
  };
}

/** Live header config seeded from the referenced header section's stored config. */
function seedHeaderConfig(
  sections: SectionRef[],
  headerSectionId: string | null
): HeaderOptions {
  const id = headerSectionId ?? BUILT_IN_SECTION_IDS.header;
  const stored = sections.find((s) => s.id === id)?.config;
  return { ...DEFAULT_HEADER_OPTIONS, ...(stored ?? {}) };
}

function createBlock(type: AddableBlockType): DocumentBlock {
  const id = nanoid();
  switch (type) {
    case "richText":
      return { id, type, visible: true, content: { type: "doc", content: [] } };
    case "keyValue":
      return { id, type, visible: true, rows: [] };
    case "spacer":
      return { id, type, visible: true, variant: "space" };
  }
}

function createEditorStore(props: DocumentTemplateProps) {
  const initial: EditorSnapshot = {
    blocks: props.initialBlocks,
    theme: props.initialTheme,
    settings: props.initialSettings,
    headerSectionId: props.initialHeaderSectionId,
    footerSectionId: props.initialFooterSectionId,
    headerConfig: seedHeaderConfig(props.sections, props.initialHeaderSectionId)
  };

  return createStore<EditorState>((set, get) => ({
    ...initial,
    baseline: snapshot(initial),
    documentType: props.documentType,
    sections: props.sections,
    customFields: props.customFields,
    termsSeed: props.termsSeed,
    previewEntities: props.previewEntities,
    hasWatermark: props.hasWatermark,
    selectedId: null,
    previewId: null,
    previewNonce: 0,
    labelSizeId: props.initialLabelSizeId ?? "label4x2",

    select: (id) => set({ selectedId: id }),
    setPreviewId: (id) => set({ previewId: id }),
    refreshPreview: () => set((s) => ({ previewNonce: s.previewNonce + 1 })),
    setLabelSizeId: (id) => set({ labelSizeId: id }),

    addBlock: (type) => {
      const block = createBlock(type);
      set((s) => ({ blocks: [...s.blocks, block], selectedId: block.id }));
    },
    addSharedBlock: (sectionId) => {
      const block: DocumentBlock = {
        id: nanoid(),
        type: "shared",
        visible: true,
        sectionId
      };
      set((s) => ({ blocks: [...s.blocks, block], selectedId: block.id }));
    },
    addCustomFieldBlock: (fieldId, label) => {
      const block: DocumentBlock = {
        id: nanoid(),
        type: "customField",
        visible: true,
        fieldId,
        label
      };
      set((s) => ({ blocks: [...s.blocks, block], selectedId: block.id }));
    },
    addField: (withLabel) => {
      const block: DocumentBlock = {
        id: nanoid(),
        type: "field",
        visible: true,
        value: "",
        ...(withLabel ? { label: "" } : {})
      };
      set((s) => ({ blocks: [...s.blocks, block], selectedId: block.id }));
    },
    removeBlock: (id) =>
      set((s) => ({
        blocks: s.blocks.filter((b) => b.id !== id),
        selectedId: s.selectedId === id ? null : s.selectedId
      })),
    toggleVisible: (id) =>
      set((s) => ({
        blocks: s.blocks.map((b) =>
          b.id === id ? { ...b, visible: !b.visible } : b
        )
      })),
    reorder: (activeId, overId) =>
      set((s) => {
        const from = s.blocks.findIndex((b) => b.id === activeId);
        const to = s.blocks.findIndex((b) => b.id === overId);
        if (from === -1 || to === -1) return {};
        return { blocks: arrayMove(s.blocks, from, to) };
      }),
    updateBlock: (id, patch) =>
      set((s) => ({
        blocks: s.blocks.map((b) =>
          b.id === id ? ({ ...b, ...patch } as DocumentBlock) : b
        )
      })),
    setThemeColor: (key, value) =>
      set((s) => ({ theme: { ...s.theme, [key]: value } })),
    setSetting: (key, value) =>
      set((s) => ({ settings: { ...s.settings, [key]: value } })),
    setHeaderSection: (sectionId) => set({ headerSectionId: sectionId }),
    setFooterSection: (sectionId) => set({ footerSectionId: sectionId }),
    setHeaderConfig: (patch) =>
      set((s) => ({ headerConfig: { ...s.headerConfig, ...patch } })),

    reset: () => {
      const { baseline } = get();
      set({ ...baseline, selectedId: null });
    },
    rebaseline: () => set((s) => ({ baseline: snapshot(s) }))
  }));
}

/** True when the editable state diverges from the last-saved baseline. */
function selectIsDirty(s: EditorState): boolean {
  return JSON.stringify(snapshot(s)) !== JSON.stringify(s.baseline);
}

interface EditorContextValue {
  store: StoreApi<EditorState>;
  save: () => void;
  isSaving: boolean;
}

const EditorContext = createContext<EditorContextValue | null>(null);

function useEditorContext(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) {
    throw new Error(
      "Document template hooks must be used within a DocumentTemplateProvider"
    );
  }
  return ctx;
}

/** Subscribe to a slice of the editor store (preferred for new code). */
export function useEditorStore<T>(selector: (s: EditorState) => T): T {
  return useStore(useEditorContext().store, selector);
}

export function DocumentTemplateProvider({
  children,
  ...props
}: PropsWithChildren<DocumentTemplateProps>) {
  const storeRef = useRef<StoreApi<EditorState> | null>(null);
  if (!storeRef.current) storeRef.current = createEditorStore(props);
  const store = storeRef.current;

  const fetcher = useFetcher<{ success?: boolean }>();
  const isSaving = fetcher.state !== "idle";
  const savedRef = useRef(false);

  const save = useCallback(() => {
    const s = store.getState();
    const formData = new FormData();
    formData.append("documentType", s.documentType);
    formData.append("blocks", JSON.stringify(s.blocks));
    formData.append("theme", JSON.stringify(s.theme));
    formData.append("settings", JSON.stringify(s.settings));
    formData.append("headerSectionId", s.headerSectionId ?? "");
    formData.append("footerSectionId", s.footerSectionId ?? "");
    formData.append("headerConfig", JSON.stringify(s.headerConfig));
    savedRef.current = true;
    fetcher.submit(formData, { method: "post", action: props.actionPath });
  }, [store, fetcher, props.actionPath]);

  // Once our save resolves, clear the dirty baseline to the just-saved state.
  useEffect(() => {
    if (savedRef.current && fetcher.state === "idle" && fetcher.data?.success) {
      savedRef.current = false;
      store.getState().rebaseline();
    }
  }, [fetcher.data, fetcher.state, store]);

  const value = useMemo(
    () => ({ store, save, isSaving }),
    [store, save, isSaving]
  );

  return (
    <EditorContext.Provider value={value}>{children}</EditorContext.Provider>
  );
}

/**
 * Back-compat accessor returning the full editor API in one object. New code
 * should prefer `useEditorStore(selector)` to subscribe to a narrow slice.
 */
export function useDocumentTemplate() {
  const { save, isSaving } = useEditorContext();
  const state = useEditorStore(
    useShallow((s) => ({
      documentType: s.documentType,
      blocks: s.blocks,
      theme: s.theme,
      settings: s.settings,
      headerSectionId: s.headerSectionId,
      footerSectionId: s.footerSectionId,
      headerConfig: s.headerConfig,
      sections: s.sections,
      customFields: s.customFields,
      termsSeed: s.termsSeed,
      previewEntities: s.previewEntities,
      hasWatermark: s.hasWatermark,
      previewId: s.previewId,
      selectedId: s.selectedId,
      select: s.select,
      setPreviewId: s.setPreviewId,
      addBlock: s.addBlock,
      addSharedBlock: s.addSharedBlock,
      addCustomFieldBlock: s.addCustomFieldBlock,
      addField: s.addField,
      removeBlock: s.removeBlock,
      toggleVisible: s.toggleVisible,
      reorder: s.reorder,
      updateBlock: s.updateBlock,
      setThemeColor: s.setThemeColor,
      setSetting: s.setSetting,
      setHeaderSection: s.setHeaderSection,
      setFooterSection: s.setFooterSection,
      setHeaderConfig: s.setHeaderConfig,
      reset: s.reset,
      isDirty: selectIsDirty(s)
    }))
  );
  return { ...state, save, isSaving };
}
