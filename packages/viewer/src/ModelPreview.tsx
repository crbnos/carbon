// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button, cn, IconButton } from "@carbon/react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  LuBox,
  LuCamera,
  LuChevronDown,
  LuDownload,
  LuEye,
  LuEyeOff,
  LuMaximize,
  LuRotateCw,
  LuTrash2,
  LuTriangleAlert,
  LuX
} from "react-icons/lu";
import type {
  ModelMetrics,
  PmiFocusRequest,
  ViewDirection
} from "./ModelCanvas";
import {
  formatPmiItem,
  groupPmiItems,
  type PmiDisplayUnit,
  type PmiDocument,
  type PmiItem,
  parsePmiDocument,
  visibleItemIds
} from "./pmi";
import { isRawRenderable } from "./raw/formats";

// The three.js renderer is code-split: a page with a model ships only this tier
// selector until the viewer scrolls into view, then loads three.js on demand.
const ModelCanvas = lazy(() =>
  import("./ModelCanvas").then((m) => ({ default: m.ModelCanvas }))
);

// The in-browser raw-CAD (WASM) fallback tier renders the user's original upload
// (GLB/STL directly; STEP/IGES via occt-import-js) whenever no assembler artifact
// exists yet — a not-yet-optimised legacy model, or the window while an optimise
// runs. It is ALWAYS the fallback, independent of whether the assembler is
// configured: server artifacts stay strictly preferred (`hasServerModel` wins
// below), the raw tier only renders when there is no server GLB. `RawModelCanvas`
// is a `lazy()` chunk, so its occt WASM only downloads when a raw actually mounts.
const RawModelCanvas = lazy(() =>
  import("./raw/RawModelCanvas").then((m) => ({
    default: m.RawModelCanvas
  }))
);

export type ModelPreviewProps = {
  /** True while a server GLB might still arrive (upload / optimise in flight).
   *  Distinguishes "preparing" (spinner) from "no preview available". */
  awaitingModel?: boolean;
  /** Instant single-draw LOD GLB (assembler), rendered immediately on visible. */
  lodUrl?: string | null;
  /** Full optimised GLB (assembler) — the interactive tier. */
  optimizedUrl?: string | null;
  /** Lossless assembly GLB — used as the interactive tier if no optimised one. */
  glbUrl?: string | null;
  /** The model's `pmi.json` (PMI read from its STEP AP242 source). When it
   *  holds items, a PMI panel lists them and the server model draws them. */
  pmiUrl?: string | null;
  /** Controls which PMI item is selected (an inspection screen's active
   *  characteristic). A change selects the item and turns the camera to it.
   *  Leave undefined to let the PMI panel own the selection. */
  selectedPmiItemId?: string | null;
  /** Called when the user picks a PMI item in the panel or on the model
   *  (null when the pick clears the selection). */
  onPmiItemSelect?: (id: string | null) => void;
  /** Static poster image (thumbnail PNG) shown before any 3D loads. */
  thumbnailUrl?: string | null;
  /** The raw uploaded file's auth-proxied URL — the WASM fallback tier renders
   *  it in-browser when no assembler artifact exists yet. */
  rawUrl?: string | null;
  /** A background optimise is running while the raw tier renders — shows a small
   *  non-blocking "Optimizing" chip so the user knows a better GLB is coming. */
  optimizing?: boolean;
  /** The last optimise Failed and won't auto-retry — surfaces a small "Optimize
   *  failed · Retry" chip over the raw tier so the user can re-fire it (otherwise
   *  a Failed model that renders via WASM has no retry affordance at all). */
  optimizeFailed?: boolean;
  /** A just-dropped local File for the same tier — instant preview while the
   *  upload / optimise is still in flight. */
  rawFile?: File | null;
  /** Filename for the download-GLB action (defaults to the URL basename). */
  downloadName?: string;
  /** The source file no longer exists in storage (legacy delete, or the upload
   *  never completed) — nothing can render or regenerate. The settled state
   *  says so instead of the generate-on-demand invitation. */
  sourceMissing?: boolean;
  /** Re-run optimise when the model settled with no GLB (shows a Retry button). */
  onRetry?: () => void;
  /** Label for the retry action — e.g. "Load Preview" when the model was never
   *  optimised (first-time affordance) vs the default "Retry" after a failure. */
  retryLabel?: string;
  /** Called when the user cancels the "preparing" wait — the host should cancel
   *  the in-flight optimise (job + run) so the row doesn't stay stuck. */
  onCancelWait?: () => void;
  mode?: "dark" | "light";
  /** Shows a camera button that hands over where the viewer's camera stands
   *  right now, for the host to redraw the model's thumbnail from there. */
  onCaptureThumbnail?: (direction: ViewDirection) => void;
  /** A capture is in flight: the camera button is disabled until it lands. */
  isCapturingThumbnail?: boolean;
  onDelete?: () => void;
  className?: string;
};

/**
 * Progressive model preview. Renders the assembler's artifacts with three.js
 * (`ModelCanvas`): the single-draw LOD paints instantly, the full optimised GLB
 * cross-fades in on top. With no server GLB the raw (WASM) tier renders the
 * original upload in-browser; failing that, a cancellable preparing state
 * (optimise in flight) or a generate-on-demand invitation. The renderer is
 * lazy-imported and only mounts once the viewer scrolls into view. Chrome:
 * dimensions/properties, unit toggle, download, reset view, click-to-interact.
 */
export function ModelPreview({
  awaitingModel = false,
  lodUrl = null,
  optimizedUrl = null,
  glbUrl = null,
  pmiUrl = null,
  selectedPmiItemId,
  onPmiItemSelect,
  thumbnailUrl = null,
  rawUrl = null,
  optimizing = false,
  optimizeFailed = false,
  rawFile = null,
  downloadName,
  sourceMissing = false,
  onRetry,
  retryLabel = "Retry",
  onCancelWait,
  mode = "dark",
  onCaptureThumbnail,
  isCapturingThumbnail = false,
  onDelete,
  className
}: ModelPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewDirectionRef = useRef<(() => ViewDirection) | null>(null);
  const inView = useInView(containerRef);
  const [fullLoaded, setFullLoaded] = useState(false);
  const [metrics, setMetrics] = useState<ModelMetrics | null>(null);
  const [resetSignal, setResetSignal] = useState(0);
  // Gate orbit until the user opts in, so scrolling the page over the viewer
  // doesn't hijack the wheel (matches the WASM viewer's "click to interact").
  const [interactive, setInteractive] = useState(false);
  // User escape from the "preparing" spinner (optimise can run minutes) —
  // drops to the settled state early. Re-arms when a retry restarts the wait.
  const [waitDismissed, setWaitDismissed] = useState(false);
  useEffect(() => {
    if (awaitingModel) setWaitDismissed(false);
  }, [awaitingModel]);

  // One display unit for Measurements and PMI. A model whose PMI names its
  // source unit starts there, unless the user has already picked one.
  const [unit, setUnit] = useState<UnitSystem>("imperial");
  const unitPickedRef = useRef(false);
  const changeUnit = useCallback((next: UnitSystem) => {
    unitPickedRef.current = true;
    setUnit(next);
  }, []);

  const pmi = usePmiDocument(pmiUrl);
  useEffect(() => {
    if (!pmi?.sourceUnit || unitPickedRef.current) return;
    setUnit(pmi.sourceUnit === "mm" ? "metric" : "imperial");
  }, [pmi]);

  const [pmiVisible, setPmiVisible] = useState(true);
  const [pmiViewId, setPmiViewId] = useState<string | null>(null);
  const [pmiSelectedId, setPmiSelectedId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<PmiFocusRequest | null>(
    null
  );
  const focusSeqRef = useRef(0);
  // The selection as last set here, so a host echoing a pick back does not
  // turn the camera a second time.
  const pmiSelectedRef = useRef<string | null>(null);
  pmiSelectedRef.current = pmiSelectedId;
  // A new document starts with nothing picked. The ref is cleared with it, so
  // a controlled selection (below) is applied again to the new document.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resets on a new document without reading it
  useEffect(() => {
    pmiSelectedRef.current = null;
    setPmiViewId(null);
    setPmiSelectedId(null);
    setFocusRequest(null);
  }, [pmi]);
  const pmiVisibleIds = useMemo(
    () => (pmi ? visibleItemIds(pmi, pmiViewId) : undefined),
    [pmi, pmiViewId]
  );
  const focusPmiItem = useCallback((id: string) => {
    pmiSelectedRef.current = id;
    setPmiSelectedId(id);
    setPmiVisible(true);
    focusSeqRef.current += 1;
    setFocusRequest({ kind: "item", id, seq: focusSeqRef.current });
  }, []);
  // Picking the selected item again clears it; picking another turns to it.
  const selectPmiItem = useCallback(
    (id: string) => {
      if (pmiSelectedId === id) {
        setPmiSelectedId(null);
        onPmiItemSelect?.(null);
        return;
      }
      focusPmiItem(id);
      onPmiItemSelect?.(id);
    },
    [pmiSelectedId, focusPmiItem, onPmiItemSelect]
  );
  // A controlled selection follows the host, also once the document arrives
  // (a new document resets the selection above).
  // biome-ignore lint/correctness/useExhaustiveDependencies: reacts to the host's id and a new document only
  useEffect(() => {
    if (selectedPmiItemId === undefined || !pmi) return;
    if (selectedPmiItemId === null) {
      setPmiSelectedId(null);
      return;
    }
    if (
      selectedPmiItemId !== pmiSelectedRef.current &&
      pmi.items.some((item) => item.id === selectedPmiItemId)
    ) {
      focusPmiItem(selectedPmiItemId);
    }
  }, [selectedPmiItemId, pmi]);
  const selectPmiView = useCallback(
    (viewId: string | null) => {
      setPmiViewId(viewId);
      setPmiSelectedId(null);
      onPmiItemSelect?.(null);
      if (viewId) {
        focusSeqRef.current += 1;
        setFocusRequest({
          kind: "view",
          id: viewId,
          seq: focusSeqRef.current
        });
      }
    },
    [onPmiItemSelect]
  );

  const interactiveUrl = optimizedUrl ?? glbUrl;
  // The instant 3D layer: the LOD if it's distinct from the interactive model
  // (else the interactive model is the only 3D layer).
  const showLodLayer = Boolean(lodUrl && interactiveUrl && !fullLoaded);
  const mainUrl = interactiveUrl ?? lodUrl;
  const hasServerModel = Boolean(mainUrl);
  // Raw (WASM) fallback tier — no server artifact exists yet, and the raw
  // source's format is one the in-browser loaders speak.
  const rawFilename = rawFile?.name ?? rawUrl?.split("?")[0] ?? "";
  const useRawTier = Boolean(
    !hasServerModel && (rawFile || rawUrl) && isRawRenderable(rawFilename)
  );

  return (
    <div
      ref={containerRef}
      // `group`, not `img`: the container holds interactive controls (retry,
      // download, reset, delete) — an `img` role hides those descendants from AT.
      role="group"
      aria-label="3D model preview"
      className={cn(
        "relative h-full min-h-[400px] w-full overflow-hidden rounded-lg border border-border bg-gradient-to-bl from-card from-50% via-card to-background shadow-md dark:border-none",
        className
      )}
    >
      {hasServerModel || useRawTier ? (
        <>
          {/* Tier 0: instant poster — thumbnail image while the 3D boots.
              Light mode only: the generated PNGs have an opaque white
              background, which reads as a white flash on a dark viewer. */}
          {thumbnailUrl && !fullLoaded && mode === "light" && (
            <img
              src={thumbnailUrl}
              alt=""
              aria-hidden
              className="absolute inset-0 h-full w-full object-contain"
            />
          )}
          {inView && (
            <Suspense fallback={null}>
              {/* Tier 0 (3D): single-draw LOD — one draw call, near-instant. */}
              {showLodLayer && lodUrl && (
                <div className="absolute inset-0">
                  <ModelCanvas
                    glbUrl={lodUrl}
                    mode={mode}
                    viewCube={false}
                    interactive={false}
                  />
                </div>
              )}
              {/* Tier 1: the full model, cross-faded in once loaded. The raw
                  (WASM) tier plugs in here through the same canvas + chrome. */}
              <div
                className="absolute inset-0 transition-opacity duration-300"
                style={{ opacity: fullLoaded || !showLodLayer ? 1 : 0 }}
              >
                {useRawTier ? (
                  <RawModelCanvas
                    url={rawUrl}
                    file={rawFile}
                    filename={rawFilename}
                    mode={mode}
                    interactive={interactive}
                    resetSignal={resetSignal}
                    onLoaded={() => setFullLoaded(true)}
                    onMetrics={setMetrics}
                  />
                ) : (
                  <ModelCanvas
                    glbUrl={mainUrl}
                    mode={mode}
                    interactive={interactive}
                    resetSignal={resetSignal}
                    viewDirectionRef={viewDirectionRef}
                    onLoaded={() => setFullLoaded(true)}
                    onMetrics={setMetrics}
                    pmi={pmi}
                    pmiVisible={pmiVisible}
                    pmiVisibleIds={pmiVisibleIds}
                    pmiSelectedId={pmiSelectedId}
                    pmiUnit={unit === "metric" ? "mm" : "in"}
                    onPmiSelect={selectPmiItem}
                    focusRequest={focusRequest}
                  />
                )}
              </div>
            </Suspense>
          )}

          {/* Background optimise running behind the raw tier — a small,
              non-blocking hint that a better GLB is on its way. Swaps out for the
              "Optimized GLB" size badge once the server model arrives. */}
          {optimizing && useRawTier && (
            <div className="absolute bottom-2 left-2 z-20 flex items-center gap-1.5 rounded-md border border-border bg-popover px-2 py-1 text-xs text-muted-foreground shadow-sm">
              <svg
                className="size-3 shrink-0 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                />
              </svg>
              <span>Optimizing…</span>
              {/* Escape hatch: without it, a run that orphans mid-flight (worker
                  crash, externally cancelled run) leaves the chip spinning with
                  no way out — cancel stamps the row Failed → retry chip shows. */}
              {onCancelWait && (
                <button
                  type="button"
                  aria-label="Cancel optimization"
                  onClick={onCancelWait}
                  className="ml-0.5 rounded p-0.5 hover:bg-muted"
                >
                  <LuX className="size-3" />
                </button>
              )}
            </div>
          )}

          {/* The optimise Failed and won't auto-retry — the raw tier still renders,
              but without this the user has no way to re-fire the optimise. Mutually
              exclusive with the Optimizing chip (hidden once a retry is in flight). */}
          {onRetry && optimizeFailed && !optimizing && useRawTier && (
            <div className="absolute bottom-2 left-2 z-20 flex items-center gap-1.5 rounded-md border border-border bg-popover px-2 py-1 text-xs text-muted-foreground shadow-sm">
              <LuTriangleAlert className="size-3 shrink-0 text-amber-500" />
              <span>Optimize failed</span>
              <button
                type="button"
                onClick={onRetry}
                className="flex items-center gap-1 font-medium text-foreground underline-offset-2 hover:underline"
              >
                <LuRotateCw className="size-3" />
                Retry
              </button>
            </div>
          )}

          {/* Measurements + unit toggle (top-left), like the WASM viewer, and
              the PMI under it — only over the server model, which draws it. */}
          {fullLoaded &&
            (metrics || (hasServerModel && pmi && pmi.items.length > 0)) && (
              <div className="absolute left-2 top-2 z-20 flex flex-col items-start gap-2">
                {metrics && (
                  <ModelMetricsPanel
                    metrics={metrics}
                    unit={unit}
                    onUnitChange={changeUnit}
                  />
                )}
                {hasServerModel && pmi && pmi.items.length > 0 && (
                  <PmiPanel
                    doc={pmi}
                    unit={unit === "metric" ? "mm" : "in"}
                    visible={pmiVisible}
                    onVisibleChange={setPmiVisible}
                    viewId={pmiViewId}
                    onViewChange={selectPmiView}
                    visibleIds={pmiVisibleIds}
                    selectedId={pmiSelectedId}
                    onSelect={selectPmiItem}
                    onUnitChange={changeUnit}
                  />
                )}
              </div>
            )}

          {/* Click-to-interact gate. */}
          {fullLoaded && !interactive && (
            <button
              type="button"
              onClick={() => setInteractive(true)}
              aria-label="Click to interact with 3D model"
              className="group absolute inset-0 z-10 flex items-end justify-center pb-4 focus:outline-none"
            >
              <span className="rounded-full border border-border bg-background/80 px-3 py-1 text-xs text-muted-foreground opacity-70 shadow-sm backdrop-blur-sm transition-opacity group-hover:opacity-100">
                Click to interact
              </span>
            </button>
          )}

          {/* Toolbar: download + reset view + thumbnail + delete. */}
          <div className="absolute bottom-2 right-2 z-20 flex items-center gap-1">
            {mainUrl && (
              <IconButton
                aria-label="Download optimised GLB"
                className="text-muted-foreground"
                icon={<LuDownload />}
                variant="ghost"
                onClick={() => downloadFile(mainUrl, downloadName)}
              />
            )}
            {fullLoaded && (
              <IconButton
                aria-label="Reset view"
                className="text-muted-foreground"
                icon={<LuMaximize />}
                variant="ghost"
                onClick={() => setResetSignal((n) => n + 1)}
              />
            )}
            {/* Only over a server GLB: that is what the thumbnail is drawn from. */}
            {fullLoaded && hasServerModel && onCaptureThumbnail && (
              <IconButton
                aria-label="Use this view as the thumbnail"
                title="Use this view as the thumbnail"
                className="text-muted-foreground"
                icon={<LuCamera />}
                variant="ghost"
                isDisabled={isCapturingThumbnail}
                onClick={() => {
                  const direction = viewDirectionRef.current?.();
                  if (direction) onCaptureThumbnail(direction);
                }}
              />
            )}
            {onDelete && (
              <IconButton
                aria-label="Delete model"
                className="text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
                icon={<LuTrash2 />}
                variant="ghost"
                onClick={onDelete}
              />
            )}
          </div>
        </>
      ) : inView && awaitingModel && !waitDismissed ? (
        // Server GLB still being prepared (upload / optimise in flight) —
        // spinner with a cancel escape (optimise can take minutes; never trap
        // the user in an unbounded wait).
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <svg
            className="h-6 w-6 animate-spin text-muted-foreground"
            viewBox="0 0 24 24"
            fill="none"
            aria-label="Preparing model"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
            />
          </svg>
          <button
            type="button"
            onClick={() => {
              setWaitDismissed(true);
              onCancelWait?.();
            }}
            className="text-xs text-muted-foreground underline-offset-2 opacity-70 transition-opacity hover:opacity-100 hover:underline"
          >
            Cancel
          </button>
        </div>
      ) : inView && sourceMissing ? (
        // The source file is gone from storage — no tier can render and no
        // regenerate can succeed. Say so plainly (a bare "3D preview" card
        // with no action reads as broken) and offer removal when the host
        // allows it, so the dead reference can be cleared.
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-4 text-center">
          <div className="flex size-11 items-center justify-center rounded-full bg-muted/60">
            <LuBox className="size-5 text-muted-foreground" />
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-foreground">
              Model file unavailable
            </p>
            <p className="text-xs text-muted-foreground">
              The source file no longer exists in storage.
            </p>
          </div>
          {onDelete && (
            <Button variant="secondary" onClick={onDelete}>
              Remove model
            </Button>
          )}
        </div>
      ) : inView ? (
        // Settled with no renderable tier. Framed as an invitation, not a
        // failure: the preview simply hasn't been generated yet (or the raw is
        // over the in-browser cap) — the primary action generates it on demand.
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-4 text-center">
          <div className="flex size-11 items-center justify-center rounded-full bg-muted/60">
            <LuBox className="size-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground">3D preview</p>
          {onRetry && <Button onClick={onRetry}>{retryLabel}</Button>}
        </div>
      ) : null}
    </div>
  );
}

type UnitSystem = "metric" | "imperial";

const MM_PER_IN = 25.4;

/** Dimensions + surface area / volume, with an mm/in toggle. Model space is mm. */
function ModelMetricsPanel({
  metrics,
  unit,
  onUnitChange
}: {
  metrics: ModelMetrics;
  unit: UnitSystem;
  onUnitChange: (unit: UnitSystem) => void;
}) {
  const [open, setOpen] = useState(false);
  const imperial = unit === "imperial";

  const fmt = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        maximumFractionDigits: imperial ? 3 : 1,
        minimumFractionDigits: 0
      }),
    [imperial]
  );

  const linear = (mm: number) => fmt.format(imperial ? mm / MM_PER_IN : mm);
  const areaVal = (mm2: number) =>
    fmt.format(imperial ? mm2 / MM_PER_IN ** 2 : mm2);
  const volVal = (mm3: number) =>
    fmt.format(imperial ? mm3 / MM_PER_IN ** 3 : mm3);
  const u = imperial ? "in" : "mm";
  const hasProps = metrics.surfaceArea !== null || metrics.volume !== null;

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-popover p-2.5 text-xs text-popover-foreground shadow-md",
        open ? "w-56" : "w-auto"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
        >
          <LuChevronDown
            className={cn("size-3 transition-transform", !open && "-rotate-90")}
          />
          Measurements
        </button>
        {open && <UnitToggle unit={unit} onChange={onUnitChange} />}
      </div>

      {open && (
        <>
          <div className="mt-2 flex flex-col gap-1 font-mono tabular-nums">
            <Row
              dot="bg-green-500"
              label="W"
              value={`${linear(metrics.dimensions.x)} ${u}`}
            />
            <Row
              dot="bg-blue-500"
              label="H"
              value={`${linear(metrics.dimensions.y)} ${u}`}
            />
            <Row
              dot="bg-red-500"
              label="L"
              value={`${linear(metrics.dimensions.z)} ${u}`}
            />
          </div>

          {hasProps && (
            <div className="mt-2 flex flex-col gap-1 border-t border-border/50 pt-2 font-mono tabular-nums text-muted-foreground">
              <Row
                label="Area"
                value={
                  metrics.surfaceArea === null
                    ? "—"
                    : `${areaVal(metrics.surfaceArea)} ${u}²`
                }
              />
              <Row
                label="Volume"
                value={
                  metrics.volume === null
                    ? "—"
                    : `${volVal(metrics.volume)} ${u}³`
                }
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The model's PMI: an eye toggle for the layer, the saved views, and the items
 * by kind. Picking an item turns it blue and turns the camera to it; picking
 * it again clears it. Copies the Measurements card.
 */
function PmiPanel({
  doc,
  unit,
  visible,
  onVisibleChange,
  viewId,
  onViewChange,
  visibleIds,
  selectedId,
  onSelect,
  onUnitChange
}: {
  doc: PmiDocument;
  unit: PmiDisplayUnit;
  visible: boolean;
  onVisibleChange: (visible: boolean) => void;
  viewId: string | null;
  onViewChange: (viewId: string | null) => void;
  visibleIds: Set<string> | undefined;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onUnitChange: (unit: UnitSystem) => void;
}) {
  const [open, setOpen] = useState(false);
  const groups = useMemo(
    () =>
      groupPmiItems(doc)
        .map((group) => ({
          ...group,
          items: visibleIds
            ? group.items.filter((item) => visibleIds.has(item.id))
            : group.items
        }))
        .filter((group) => group.items.length > 0),
    [doc, visibleIds]
  );

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-popover p-2.5 text-xs text-popover-foreground shadow-md",
        open ? "w-64" : "w-auto"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
        >
          <LuChevronDown
            className={cn("size-3 transition-transform", !open && "-rotate-90")}
          />
          PMI
          <span className="tabular-nums">{doc.items.length}</span>
        </button>
        <IconButton
          aria-label={visible ? "Hide PMI" : "Show PMI"}
          title={visible ? "Hide PMI" : "Show PMI"}
          className="-my-1 text-muted-foreground"
          icon={visible ? <LuEye /> : <LuEyeOff />}
          variant="ghost"
          size="sm"
          onClick={() => onVisibleChange(!visible)}
        />
      </div>

      {open && (
        <>
          <div className="mt-2 flex justify-end">
            <UnitToggle
              unit={unit === "mm" ? "metric" : "imperial"}
              onChange={onUnitChange}
            />
          </div>
          {doc.views.length > 0 && (
            <select
              aria-label="Saved view"
              value={viewId ?? ""}
              onChange={(event) => onViewChange(event.target.value || null)}
              className="mt-2 w-full rounded-md border-none bg-muted/60 px-2 py-1 text-[11px] font-medium text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">All PMI</option>
              {doc.views.map((view) => (
                <option key={view.id} value={view.id}>
                  {view.name}
                </option>
              ))}
            </select>
          )}

          <div className="mt-2 flex max-h-64 flex-col gap-2 overflow-y-auto">
            {groups.map((group) => (
              <div key={group.kind} className="flex flex-col gap-0.5">
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {group.title}
                </span>
                {group.items.map((item) => (
                  <PmiRow
                    key={item.id}
                    item={item}
                    unit={unit}
                    sourceUnit={doc.sourceUnit}
                    selected={item.id === selectedId}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PmiRow({
  item,
  unit,
  sourceUnit,
  selected,
  onSelect
}: {
  item: PmiItem;
  unit: PmiDisplayUnit;
  sourceUnit: PmiDisplayUnit | null;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const { label, symbol, title } = formatPmiItem(item, unit, sourceUnit);
  // A tolerance prints as its frame (`⌖ | ⌀0.1 | A`) and a datum as its
  // boxed letter, the way the drawing shows them.
  const cells = item.kind === "tolerance" ? label.split(" | ") : null;
  return (
    <button
      type="button"
      title={title}
      aria-pressed={selected}
      onClick={() => onSelect(item.id)}
      className={cn(
        "flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left font-mono tabular-nums transition-colors hover:bg-accent",
        selected && "bg-accent text-accent-foreground"
      )}
    >
      {cells ? (
        <span className="flex min-w-0 divide-x divide-border border border-border">
          {cells.map((cell, index) => (
            <span key={index} className="whitespace-nowrap px-1">
              {cell}
            </span>
          ))}
        </span>
      ) : item.kind === "datum" ? (
        <span className="border border-border px-1">{label}</span>
      ) : (
        <>
          {symbol && <span>{symbol}</span>}
          <span className="truncate">{label}</span>
        </>
      )}
    </button>
  );
}

/**
 * Fetches and parses `pmi.json`. Null while loading, on any failure, or for a
 * document the viewer cannot read — the preview then simply shows no PMI.
 */
function usePmiDocument(url: string | null): PmiDocument | null {
  const [doc, setDoc] = useState<PmiDocument | null>(null);
  useEffect(() => {
    setDoc(null);
    if (!url) return;
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((json: unknown) => {
        if (!controller.signal.aborted) setDoc(parsePmiDocument(json));
      })
      .catch(() => {
        // The preview works without PMI: a failed fetch just shows no panel
        // (the request itself is in the network log).
        if (!controller.signal.aborted) setDoc(null);
      });
    return () => controller.abort();
  }, [url]);
  return doc;
}

/** iOS-style segmented mm/in toggle — lighter than the tab pills. */
function UnitToggle({
  unit,
  onChange
}: {
  unit: UnitSystem;
  onChange: (u: UnitSystem) => void;
}) {
  return (
    <div className="flex rounded-md bg-muted/60 p-0.5">
      {(["metric", "imperial"] as const).map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          className={cn(
            "min-w-[30px] rounded px-2 py-1 text-center text-[11px] font-medium leading-none transition-colors",
            unit === value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {value === "metric" ? "mm" : "in"}
        </button>
      ))}
    </div>
  );
}

function Row({
  dot,
  label,
  value
}: {
  dot?: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5">
        {dot && <span className={cn("size-2 rounded-full", dot)} />}
        {label}
      </span>
      <span>{value}</span>
    </div>
  );
}

/** Trigger a browser download of a same-origin URL (the served GLB proxy). */
function downloadFile(url: string, name?: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name ?? url.split("/").pop()?.split("?")[0] ?? "model.glb";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/**
 * True once the element has scrolled within `rootMargin` of the viewport — then
 * it stays true (we only need to trigger the one-time lazy load). Native
 * IntersectionObserver; no dependency.
 */
function useInView(ref: React.RefObject<Element | null>) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, inView]);
  return inView;
}
