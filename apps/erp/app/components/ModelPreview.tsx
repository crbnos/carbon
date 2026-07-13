import { cn, IconButton } from "@carbon/react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { LuTrash2 } from "react-icons/lu";

// Heavy renderers are code-split: a page with a model ships only this tier
// selector until the viewer scrolls into view, then loads three.js (interactive
// tier) or online-3d-viewer WASM (fallback) on demand.
const ModelCanvas = lazy(() =>
  import("@carbon/viewer/canvas").then((m) => ({ default: m.ModelCanvas }))
);
const WasmModelViewer = lazy(() =>
  import("@carbon/react/ModelViewer").then((m) => ({ default: m.ModelViewer }))
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
 * are lazy-imported and only mount once the viewer scrolls into view.
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
                  <ModelCanvas glbUrl={lodUrl} mode={mode} viewCube={false} />
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
                  onLoaded={() => setFullLoaded(true)}
                />
              </div>
            </Suspense>
          )}
          {onDelete && (
            <IconButton
              aria-label="Delete model"
              className="absolute bottom-2 right-2 z-10 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
              icon={<LuTrash2 />}
              variant="ghost"
              onClick={onDelete}
            />
          )}
        </>
      ) : inView ? (
        // No server artifact yet → WASM source tessellation (lazy).
        <Suspense fallback={null}>
          <WasmModelViewer
            file={sourceFile}
            url={sourceUrl}
            mode={mode}
            onDelete={onDelete}
            className="absolute inset-0 min-h-0 border-none shadow-none"
          />
        </Suspense>
      ) : null}
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
