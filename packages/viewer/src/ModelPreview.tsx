import { Button, cn, IconButton } from "@carbon/react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  LuBox,
  LuChevronDown,
  LuDownload,
  LuMaximize,
  LuTrash2
} from "react-icons/lu";
import type { ModelMetrics } from "./ModelCanvas";
import { isRawRenderable } from "./raw/formats";

// The three.js renderer is code-split: a page with a model ships only this tier
// selector until the viewer scrolls into view, then loads three.js on demand.
const ModelCanvas = lazy(() =>
  import("./ModelCanvas").then((m) => ({ default: m.ModelCanvas }))
);

// Build-time switch for the in-browser raw-CAD (WASM) fallback tier: renders the
// user's original upload (GLB/STL directly; STEP/IGES via occt-import-js) when
// no assembler artifact exists. ON by default; a deployment that relies purely on
// assembler artifacts opts out with VITE_CAD_VIEWER_USE_SERVER=true, and the
// exact `import.meta.env.X` form is statically replaced by Vite so the whole
// tier — occt WASM included — is then dead-code-eliminated from the build.
// Exported so hosts can align their fallback logic (e.g. CadModel only treats
// a small raw as renderable when the tier actually shipped in this build).
export const WASM_RAW_ENABLED =
  import.meta.env.VITE_CAD_VIEWER_USE_SERVER !== "true";
const RawModelCanvas = WASM_RAW_ENABLED
  ? lazy(() =>
      import("./raw/RawModelCanvas").then((m) => ({
        default: m.RawModelCanvas
      }))
    )
  : null;

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
  /** Static poster image (thumbnail PNG) shown before any 3D loads. */
  thumbnailUrl?: string | null;
  /** The raw uploaded file's auth-proxied URL — the WASM fallback tier renders
   *  it in-browser when no assembler artifact exists (build-flag gated). */
  rawUrl?: string | null;
  /** A just-dropped local File for the same tier — instant preview while the
   *  upload / optimise is still in flight. */
  rawFile?: File | null;
  /** Filename for the download-GLB action (defaults to the URL basename). */
  downloadName?: string;
  /** Re-run optimise when the model settled with no GLB (shows a Retry button). */
  onRetry?: () => void;
  /** Label for the retry action — e.g. "Load Preview" when the model was never
   *  optimised (first-time affordance) vs the default "Retry" after a failure. */
  retryLabel?: string;
  /** Called when the user cancels the "preparing" wait — the host should cancel
   *  the in-flight optimise (job + run) so the row doesn't stay stuck. */
  onCancelWait?: () => void;
  mode?: "dark" | "light";
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
  thumbnailUrl = null,
  rawUrl = null,
  rawFile = null,
  downloadName,
  onRetry,
  retryLabel = "Retry",
  onCancelWait,
  mode = "dark",
  onDelete,
  className
}: ModelPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
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

  const interactiveUrl = optimizedUrl ?? glbUrl;
  // The instant 3D layer: the LOD if it's distinct from the interactive model
  // (else the interactive model is the only 3D layer).
  const showLodLayer = Boolean(lodUrl && interactiveUrl && !fullLoaded);
  const mainUrl = interactiveUrl ?? lodUrl;
  const hasServerModel = Boolean(mainUrl);
  // Raw (WASM) fallback tier — only when compiled in, no artifact exists, and
  // the raw source's format is one the in-browser loaders speak.
  const rawFilename = rawFile?.name ?? rawUrl?.split("?")[0] ?? "";
  const useRawTier = Boolean(
    !hasServerModel &&
      RawModelCanvas &&
      (rawFile || rawUrl) &&
      isRawRenderable(rawFilename)
  );

  return (
    <div
      ref={containerRef}
      role="img"
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
                {useRawTier && RawModelCanvas ? (
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
                    onLoaded={() => setFullLoaded(true)}
                    onMetrics={setMetrics}
                  />
                )}
              </div>
            </Suspense>
          )}

          {/* Measurements + unit toggle (top-left), like the WASM viewer. */}
          {metrics && fullLoaded && <ModelMetricsPanel metrics={metrics} />}

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

          {/* Toolbar: download + reset view + delete. */}
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
function ModelMetricsPanel({ metrics }: { metrics: ModelMetrics }) {
  const [unit, setUnit] = useState<UnitSystem>("imperial");
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
        "absolute left-2 top-2 z-20 rounded-lg border border-border bg-popover p-2.5 text-xs text-popover-foreground shadow-md",
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
        {open && <UnitToggle unit={unit} onChange={setUnit} />}
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
