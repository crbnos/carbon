// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  BUILT_IN_SECTION_IDS,
  type CollectedValues,
  DEFAULT_HEADER_OPTIONS,
  type DocumentBlock,
  type DocumentBlockType,
  type DocumentSettings,
  type DocumentTemplateType,
  type DocumentTheme,
  diffDocumentEdit,
  HEADER_TEXT_KEYS,
  type HeaderOptions,
  keepSummaryWithLineItems,
  type TextProblem,
  validateDocumentEdit,
  validateTemplateText
} from "@carbon/documents/template";
import { getLogger } from "@carbon/logger";
import { useAction } from "@carbon/query";
import type { JSONContent } from "@carbon/react";
import { toast } from "@carbon/react";
import { arrayMove } from "@dnd-kit/sortable";
import { useLingui } from "@lingui/react/macro";
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
import type { StoreApi } from "zustand";
import { createStore, useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";

const logger = getLogger("erp", "document-template-editor");

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

export interface TextFocus {
  scope: string;
  key: string;
  nonce: number;
  fromPage: boolean;
  caret: boolean;
}

/** A real record the preview can render against (id + readable label). */
export interface PreviewEntity {
  id: string;
  label: string;
}

/**
 * The editor opened on one record ("Edit document") instead of the company
 * template: saves go to that record's `documentEdit` row.
 */
export interface DocumentMode {
  /** The record id (a purchase order id, a shipment id for a packing slip...). */
  id: string;
  /** Its readable number, for the title bar. */
  label: string;
  /** The record is locked, so its document is read-only. */
  locked: boolean;
  /** The record's Notes column exists (some documents have no Notes block). */
  hasNotes: boolean;
  /** The company template, for "Reset to template". */
  template: { blocks: DocumentBlock[]; settings: DocumentSettings };
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
  /** Document mode only: the record's notes, edited in the Notes block. */
  notes: JSONContent | null;
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
  /**
   * The text the panel shows: `scope` is a block id, or "document" for the
   * template's own texts. `fromPage` when a click on the page chose it; `caret`
   * puts the caret in it; `nonce` makes a second click on the same text count.
   */
  textFocus: TextFocus | null;
  /** Set when the editor edits one record's document, not the template. */
  document: DocumentMode | null;
  /** What the preview prints from: the sample's or a record's, once read. */
  documentValues: CollectedValues | null;
  /** Snapshot of the last-saved state; drives `isDirty` and `reset`. */
  baseline: EditorSnapshot;
  // actions
  select: (id: string | null) => void;
  setPreviewId: (id: string | null) => void;
  /** Force a fresh preview render without changing any template state. */
  refreshPreview: () => void;
  setLabelSizeId: (id: string) => void;
  /** Select the panel that edits this text and show the text in it. */
  focusText: (
    scope: string,
    key: string,
    fromPage?: boolean,
    caret?: boolean
  ) => void;
  setDocumentValues: (values: CollectedValues | null) => void;
  setNotes: (notes: JSONContent | null) => void;
  /** Document mode: drop this document's edits, back to the company template. */
  resetToTemplate: () => void;
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
  /** Marks what was saved as clean; what was typed since stays a change. */
  rebaseline: (saved: EditorSnapshot) => void;
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
  /** Edit one record's document instead of the company template. */
  document?: DocumentMode;
  initialNotes?: JSONContent | null;
  /** Called after a successful save of one document, saying what it changed. */
  onSaved?: (saved: { notesChanged: boolean; stillEditing: boolean }) => void;
}

function snapshot(s: EditorSnapshot): EditorSnapshot {
  return {
    blocks: s.blocks,
    theme: s.theme,
    settings: s.settings,
    headerSectionId: s.headerSectionId,
    footerSectionId: s.footerSectionId,
    headerConfig: s.headerConfig,
    notes: s.notes
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

/**
 * Which panel edits a text: its block's, or for the document's own texts the
 * header's (`HEADER_TEXT_KEYS`) or the footer's.
 */
function panelFor(blocks: DocumentBlock[], scope: string, key: string) {
  if (scope !== "document") return scope;
  return HEADER_TEXT_KEYS.includes(key)
    ? (blocks.find((b) => b.type === "header")?.id ?? null)
    : FOOTER_BLOCK_ID;
}

/**
 * The notes to post, only when the user changed them: the record's page can change
 * them while the modal is open, and an untouched draft must not overwrite that.
 */
export function changedNotes(
  s: Pick<EditorState, "document" | "notes" | "baseline">
): string | undefined {
  const notes = JSON.stringify(s.notes);
  return s.document?.hasNotes && notes !== JSON.stringify(s.baseline.notes)
    ? notes
    : undefined;
}

/** What is wrong with the draft: all of a template; only the edit, on one document. */
export function draftProblems(
  s: Pick<EditorState, "documentType" | "document" | "blocks" | "settings">
): TextProblem[] {
  const draft = { blocks: s.blocks, settings: s.settings };
  return s.document
    ? validateDocumentEdit(
        s.documentType,
        s.document.template,
        diffDocumentEdit(s.documentType, s.document.template, draft)
      )
    : validateTemplateText({ documentType: s.documentType, ...draft });
}

function useDescribeProblem() {
  const { t } = useLingui();
  return useCallback(
    (problem: TextProblem) => {
      if (problem.code === "unknownVariable") {
        const variable = `{${problem.token}}`;
        return t`Unknown variable ${variable}`;
      }
      if (problem.code === "notHideable") return t`This text can't be hidden`;
      if (problem.code === "valueLocked") {
        return t`Amounts and quantities can't be changed on one document.`;
      }
      if (problem.code === "amountRemoved") {
        return t`This figure must stay. Add it back with Insert value.`;
      }
      if (problem.code === "amountChanged") {
        return t`A number or sign next to a figure changes what it says. Put a word between them.`;
      }
      return t`This text is not part of this document`;
    },
    [t]
  );
}

/** What is wrong with the draft now, keyed `${blockId}:${field}`, worded. */
export function useTextErrors(): Record<string, string> {
  const describeProblem = useDescribeProblem();
  const draft = useEditorStore(
    useShallow((s) => ({
      documentType: s.documentType,
      document: s.document,
      blocks: s.blocks,
      settings: s.settings
    }))
  );
  return useMemo(
    () =>
      Object.fromEntries(
        draftProblems(draft).map((problem) => [
          `${problem.blockId}:${problem.field}`,
          describeProblem(problem)
        ])
      ),
    [draft, describeProblem]
  );
}

function createEditorStore(props: DocumentTemplateProps) {
  const initial: EditorSnapshot = {
    blocks: props.initialBlocks,
    theme: props.initialTheme,
    settings: props.initialSettings,
    headerSectionId: props.initialHeaderSectionId,
    footerSectionId: props.initialFooterSectionId,
    headerConfig: seedHeaderConfig(
      props.sections,
      props.initialHeaderSectionId
    ),
    notes: props.initialNotes ?? null
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
    textFocus: null,
    documentValues: null,
    document: props.document ?? null,

    select: (id) => set({ selectedId: id, textFocus: null }),
    setPreviewId: (id) => set({ previewId: id }),
    refreshPreview: () => set((s) => ({ previewNonce: s.previewNonce + 1 })),
    setLabelSizeId: (id) => set({ labelSizeId: id }),
    setNotes: (notes) => set({ notes }),
    resetToTemplate: () =>
      set((s) =>
        s.document
          ? {
              blocks: s.document.template.blocks,
              settings: s.document.template.settings,
              // The Terms editor reads its text once, so it must remount.
              selectedId: null,
              textFocus: null
            }
          : {}
      ),
    focusText: (scope, key, fromPage = false, caret = fromPage) =>
      set((s) => ({
        selectedId: panelFor(s.blocks, scope, key),
        textFocus: {
          scope,
          key,
          fromPage,
          caret,
          nonce: (s.textFocus?.nonce ?? 0) + 1
        }
      })),
    setDocumentValues: (documentValues) => set({ documentValues }),

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
        return {
          blocks: keepSummaryWithLineItems(arrayMove(s.blocks, from, to))
        };
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
      set((s) => ({
        settings: { ...s.settings, [key]: value }
      })),
    setHeaderSection: (sectionId) => set({ headerSectionId: sectionId }),
    setFooterSection: (sectionId) => set({ footerSectionId: sectionId }),
    setHeaderConfig: (patch) =>
      set((s) => ({ headerConfig: { ...s.headerConfig, ...patch } })),

    reset: () => {
      const { baseline } = get();
      set({ ...baseline, selectedId: null });
    },
    rebaseline: (saved) => set({ baseline: saved })
  }));
}

/** True when the editable state diverges from the last-saved baseline. */
function selectIsDirty(s: EditorState): boolean {
  return JSON.stringify(snapshot(s)) !== JSON.stringify(s.baseline);
}

interface EditorContextValue {
  store: StoreApi<EditorState>;
  save: () => void;
  /** Whether the draft has a problem. If so, shows it next to its text. */
  refuseDraft: () => boolean;
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

const PickBlockContext = createContext<((id: string) => void) | null>(null);

/** Overrides what tapping a block row does (the compact editor's panes). */
export const PickBlockProvider = PickBlockContext.Provider;

/** Tapping a block row: toggles its selection unless a provider overrides it. */
export function usePickBlock() {
  const selectedId = useEditorStore((s) => s.selectedId);
  const select = useEditorStore((s) => s.select);
  const onPick = useContext(PickBlockContext);
  return (id: string) =>
    onPick ? onPick(id) : select(selectedId === id ? null : id);
}

export function DocumentTemplateProvider({
  children,
  ...props
}: PropsWithChildren<DocumentTemplateProps>) {
  const storeRef = useRef<StoreApi<EditorState> | null>(null);
  if (!storeRef.current) storeRef.current = createEditorStore(props);
  const store = storeRef.current;

  // Sections are reference data, not draft state: the section modal saves them
  // through its own action and the route loader revalidates. Resync them into
  // the store so a reopened modal seeds from the fresh row (e.g. the footer's
  // registration-line config), leaving the user's draft untouched.
  useEffect(() => {
    store.setState({ sections: props.sections });
  }, [store, props.sections]);

  const { t } = useLingui();
  const describeProblem = useDescribeProblem();
  // What the save in flight holds: words typed after it are not saved by it.
  const submitted = useRef<EditorSnapshot | null>(null);
  const fetcher = useAction({
    onSuccess: () => {
      const sent = submitted.current;
      const state = store.getState();
      const notesChanged =
        changedNotes(sent ? { ...state, notes: sent.notes } : state) !==
        undefined;
      if (sent) state.rebaseline(sent);
      if (store.getState().document) {
        toast.success(t`Saved this document`);
        props.onSaved?.({
          notesChanged,
          // Words typed while it saved stay open, to be saved or cancelled.
          stillEditing: selectIsDirty(store.getState())
        });
      } else {
        toast.success(t`Saved document layout`);
      }
    }
  });
  const isSaving = fetcher.state !== "idle";

  // Refused here first, so the error sits next to the text that caused it; the
  // server runs the same check.
  const refuseDraft = useCallback(() => {
    const s = store.getState();
    const first = draftProblems(s)[0];
    if (!first) return false;
    if (first.code !== "valueLocked") s.focusText(first.blockId, first.field);
    toast.error(describeProblem(first));
    return true;
  }, [store, describeProblem]);

  const save = useCallback(() => {
    if (refuseDraft()) return;
    const s = store.getState();
    submitted.current = snapshot(s);
    const formData = new FormData();
    if (s.document) {
      if (s.document.locked) return;
      // One record's document: its words and blocks, plus the record's notes.
      formData.append("blocks", JSON.stringify(s.blocks));
      formData.append("settings", JSON.stringify(s.settings));
      const notes = changedNotes(s);
      if (notes !== undefined) formData.append("notes", notes);
      fetcher.submit(formData, { method: "post", action: props.actionPath });
      return;
    }
    formData.append("documentType", s.documentType);
    formData.append("blocks", JSON.stringify(s.blocks));
    formData.append("theme", JSON.stringify(s.theme));
    formData.append("settings", JSON.stringify(s.settings));
    formData.append("headerSectionId", s.headerSectionId ?? "");
    formData.append("footerSectionId", s.footerSectionId ?? "");
    formData.append("headerConfig", JSON.stringify(s.headerConfig));
    fetcher.submit(formData, { method: "post", action: props.actionPath });
  }, [store, fetcher, props.actionPath, refuseDraft]);

  const value = useMemo(
    () => ({ store, save, refuseDraft, isSaving }),
    [store, save, refuseDraft, isSaving]
  );

  return (
    <EditorContext.Provider value={value}>{children}</EditorContext.Provider>
  );
}

export function useIsDirty() {
  return useEditorStore(selectIsDirty);
}

/**
 * Loads the values a preview prints, for its clicks and a document's pencils. A
 * plain fetch, because a fetcher's failure replaces the whole page with its error
 * screen. Without the values a click reads only the words, and there are no
 * pencils.
 */
export function useLoadPrintedValues(path: string) {
  const setDocumentValues = useEditorStore((s) => s.setDocumentValues);

  useEffect(() => {
    setDocumentValues(null);
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(path, { signal: controller.signal });
        if (!response.ok) return;
        const values: { data: CollectedValues } = await response.json();
        if (!controller.signal.aborted) setDocumentValues(values.data);
      } catch (error) {
        if (!controller.signal.aborted) {
          logger.error("Failed to read the printed values", { error });
        }
      }
    })();
    return () => controller.abort();
  }, [path, setDocumentValues]);
}

/**
 * Back-compat accessor returning the full editor API in one object. New code
 * should prefer `useEditorStore(selector)` to subscribe to a narrow slice.
 */
export function useDocumentTemplate() {
  const { save, refuseDraft, isSaving } = useEditorContext();
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
      reset: s.reset
    }))
  );
  return { ...state, save, refuseDraft, isSaving };
}
