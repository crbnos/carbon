"use client";

/* Mermaid diagrams for the Reference. A ```mermaid fence in MDX is rewritten to
 * <Mermaid chart="..."> by remarkMermaid (source.config.ts), so authors write plain
 * markdown and never touch this component directly.
 *
 * Mermaid needs a DOM to measure text, so it cannot render on the server: the chart
 * is drawn in an effect after mount and the library itself is code-split behind a
 * dynamic import, loading only on pages that actually have a diagram. Until it lands
 * we hold the layout with a skeleton at the box's own min height, so the page doesn't
 * jump when the SVG arrives.
 *
 * The SVG string is rendered once here and handed to <Zoomable> as markup, not as a
 * nested component — Zoomable renders its children twice (thumbnail + lightbox), and
 * a component child would mean two mermaid renders per diagram. */

import { useEffect, useId, useRef, useState } from "react";
import { Zoomable } from "@/components/editorial/zoomable";

/* Warm-paper palette, light-only like the rest of the site. Mermaid's "base" theme is
 * the only one that takes themeVariables, so every color the diagrams use is stated
 * here rather than inherited — values mirror the --color-ed-* tokens in global.css. */
const THEME_VARIABLES = {
  background: "#fbfbfb",
  primaryColor: "#f5f5f5",
  primaryTextColor: "#262323",
  primaryBorderColor: "#d2d2d2",
  secondaryColor: "#eaf8ff",
  secondaryBorderColor: "#a9daf3",
  tertiaryColor: "#f6f6f6",
  tertiaryBorderColor: "#e3e3e3",
  lineColor: "#9a9a9a",
  textColor: "#262323",
  mainBkg: "#f5f5f5",
  nodeBorder: "#d2d2d2",
  nodeTextColor: "#262323",
  clusterBkg: "#fbfbfb",
  clusterBorder: "#e3e3e3",
  edgeLabelBackground: "#fbfbfb",
  titleColor: "#262323",
  fontFamily: "var(--font-sans), ui-sans-serif, system-ui, sans-serif",
  fontSize: "14px",
  // Sequence diagrams have their own variable set; without these the actor boxes
  // fall back to mermaid's default lilac.
  actorBkg: "#f5f5f5",
  actorBorder: "#d2d2d2",
  actorTextColor: "#262323",
  actorLineColor: "#c9c9c9",
  signalColor: "#262323",
  signalTextColor: "#262323",
  labelBoxBkgColor: "#eaf8ff",
  labelBoxBorderColor: "#a9daf3",
  labelTextColor: "#262323",
  loopTextColor: "#262323",
  noteBkgColor: "#fff2d8",
  noteBorderColor: "#e6cfa3",
  noteTextColor: "#9c7136",
  sequenceNumberColor: "#fbfbfb",
} as const;

type State =
  | { status: "loading" }
  | { status: "ready"; svg: string; naturalWidth: number }
  | { status: "error"; message: string };

/* Past this natural width the diagram is shrunk far enough in the prose column that the
 * labels stop being readable, so the caption tells the reader to open it full size. */
const WIDE_PX = 900;

export function Mermaid({ chart, caption }: { chart: string; caption?: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  // useId() contains ":" which is illegal in an SVG/CSS id — mermaid builds selectors
  // from the id it is given, so strip it.
  const id = `mermaid-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  // React 18+ runs effects twice in dev StrictMode; the second pass would set state on
  // a render that has already been thrown away.
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "base",
          themeVariables: THEME_VARIABLES,
          securityLevel: "strict",
          // wrappingWidth breaks long node labels onto more lines, which is what keeps
          // these diagrams from laying out 2,500px wide and shrinking to illegibility in
          // a ~600px prose column. Tighter node/rank spacing pulls in the rest.
          flowchart: {
            curve: "basis",
            useMaxWidth: true,
            padding: 10,
            nodeSpacing: 28,
            rankSpacing: 48,
            wrappingWidth: 110,
          },
          sequence: { useMaxWidth: true, actorMargin: 42, mirrorActors: false },
        });
        const { svg } = await mermaid.render(id, chart);
        // Natural width vs the prose column decides whether the reader is told to zoom.
        // Flowcharts carry a viewBox; sequence diagrams don't, and only state their real
        // width in the inline `max-width` — read both or every sequence diagram scores 0.
        const vb = /viewBox="0 0 ([\d.]+)/.exec(svg);
        const mw = /style="[^"]*max-width:\s*([\d.]+)px/.exec(svg);
        if (live.current)
          setState({
            status: "ready",
            svg,
            naturalWidth: Number(vb?.[1] ?? mw?.[1] ?? 0),
          });
      } catch (err) {
        // A malformed diagram leaves an orphaned #d<id> measuring node in <body>.
        document.getElementById(`d${id}`)?.remove();
        if (live.current)
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "Diagram failed to render",
          });
      }
    })();
    return () => {
      live.current = false;
    };
  }, [chart, id]);

  if (state.status === "error") {
    return (
      <figure className="my-8">
        <div className="rounded-[14px] border border-ed-amber-stroke bg-ed-amber-fill px-5 py-4">
          <p className="m-0 font-mono text-ed-12 text-ed-amber-text">
            Diagram failed to render: {state.message}
          </p>
        </div>
      </figure>
    );
  }

  return (
    <figure className="my-8">
      {state.status === "loading" ? (
        <div className="flex min-h-[220px] w-full items-center justify-center rounded-[14px] border border-ed-hairline bg-ed-paper">
          <span className="font-mono text-ed-10 uppercase tracking-[0.08em] text-ed-ink/35">
            Drawing diagram
          </span>
        </div>
      ) : (
        <Zoomable wide={state.naturalWidth > WIDE_PX}>
          <div className="ed-mermaid overflow-hidden rounded-[14px] border border-ed-hairline bg-ed-paper px-4 py-6 sm:px-6">
            {/* biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid's own sanitized SVG output */}
            <div dangerouslySetInnerHTML={{ __html: state.svg }} />
          </div>
        </Zoomable>
      )}
      {(caption || (state.status === "ready" && state.naturalWidth > WIDE_PX)) && (
        <figcaption className="mt-2.5 text-center text-ed-13 font-book leading-[150%] text-ed-ink/55">
          {caption}
          {state.status === "ready" && state.naturalWidth > WIDE_PX && (
            <span className="ml-1.5 whitespace-nowrap text-ed-ink/40">Click to enlarge.</span>
          )}
        </figcaption>
      )}
    </figure>
  );
}
