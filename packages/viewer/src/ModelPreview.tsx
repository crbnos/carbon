import { cn, IconButton } from "@carbon/react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { LuChevronDown, LuMaximize, LuTrash2 } from "react-icons/lu";
import type { ModelMetrics } from "./ModelCanvas";

// Heavy renderers are code-split: a page with a model ships only this tier
// selector until the viewer scrolls into view, then loads three.js (interactive
// tier) or online-3d-viewer WASM (fallback) on demand.
const ModelCanvas = lazy(() =>
  import("./ModelCanvas").then((m) => ({ default: m.ModelCanvas }))
);
const WasmModelViewer = lazy(() =>
  import("./WasmModelViewer").then((m) => ({ default: m.ModelViewer }))
);

export type ModelPreviewProps = {
  /** Raw source model — the WASM fallback (STEP/etc.) when no server GLB exists. */
  sourceUrl?: string | null;
  /** Just-uploaded in-memory file — also the WASM fallback path. */
  sourceFile?: File | null;
  /** Instant single-draw LOD GLB (assembler), rendered immediately on visible. */
  lodUrl?: string | null;
  /** Full optimised GLB (assembler) — the interactive tier. */
  optimizedUrl?: string | null;
  /** Lossless assembly GLB — used as the interactive tier if no optimised one. */
  glbUrl?: string | null;
  /** Static poster image (thumbnail PNG) shown before any 3D loads. */
  thumbnailUrl?: string | null;
  mode?: "dark" | "light";
  onDelete?: () => void;
  className?: string;
};

/**
 * Progressive model preview. When the assembler has produced artifacts it renders
 * them with three.js (`ModelCanvas`): the single-draw LOD paints instantly, the
 * full optimised GLB cross-fades in on top. Only when there is no server GLB does
 * it fall back to WASM source tessellation (`online-3d-viewer`). Both renderers
 * are lazy-imported and only mount once the viewer scrolls into view. Carries the
 * same viewer chrome as the WASM viewer — dimensions/properties, unit toggle,
 * reset view, click-to-interact — over the three.js tier.
 */
export function ModelPreview({
  sourceUrl = null,
  sourceFile = null,
  lodUrl = null,
  optimizedUrl = null,
  glbUrl = null,
  thumbnailUrl = null,
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

  const interactiveUrl = optimizedUrl ?? glbUrl;
  // The instant 3D layer: the LOD if it's distinct from the interactive model
  // (else the interactive model is the only 3D layer).
  const showLodLayer = Boolean(lodUrl && interactiveUrl && !fullLoaded);
  const mainUrl = interactiveUrl ?? lodUrl;
  const hasServerModel = Boolean(mainUrl);

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
      {hasServerModel ? (
        <>
          {/* Tier 0: instant poster — thumbnail image while the 3D boots. */}
          {thumbnailUrl && !fullLoaded && (
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
              {/* Tier 1: the full model, cross-faded in once loaded. */}
              <div
                className="absolute inset-0 transition-opacity duration-300"
                style={{ opacity: fullLoaded || !showLodLayer ? 1 : 0 }}
              >
                <ModelCanvas
                  glbUrl={mainUrl}
                  mode={mode}
                  interactive={interactive}
                  resetSignal={resetSignal}
                  onLoaded={() => setFullLoaded(true)}
                  onMetrics={setMetrics}
                />
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

          {/* Toolbar: reset view + delete. */}
          <div className="absolute bottom-2 right-2 z-20 flex items-center gap-1">
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
      ) : inView && (sourceUrl || sourceFile) ? (
        // Genuinely no server model → WASM source tessellation (lazy). Only
        // mounted when a source is actually provided, so the ~3 MB online-3d-
        // viewer + occt WASM chunk never loads while an optimised GLB is still
        // on its way.
        <Suspense fallback={null}>
          <WasmModelViewer
            file={sourceFile}
            url={sourceUrl}
            mode={mode}
            onDelete={onDelete}
            className="absolute inset-0 min-h-0 border-none shadow-none"
          />
        </Suspense>
      ) : inView ? (
        // Waiting on the server model (optimise in flight) — a spinner, not WASM.
        <div className="absolute inset-0 flex items-center justify-center">
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
        </div>
      ) : null}
    </div>
  );
}

type UnitSystem = "metric" | "imperial";

const MM_PER_IN = 25.4;

/** Dimensions + surface area / volume, with an mm/in toggle. Model space is mm. */
function ModelMetricsPanel({ metrics }: { metrics: ModelMetrics }) {
  const [unit, setUnit] = useState<UnitSystem>("metric");
  const [open, setOpen] = useState(true);
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
