// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../utils/cn";
import type { Obstacle } from "./bar-spider";
import { createBarSpider, HIT_SIZE } from "./bar-spider";
import { BAR_HEIGHT } from "./corner-web";
import { LEG_BAND, LEG_COLOUR, RealSpiderBody } from "./RealSpider";

// The top bar's corner webs and the spider that crawls along the bar between
// them. The layer covers the bar but is drawing only: every click passes
// through it. The spider's own button is the one thing that takes a click,
// and only while it is clear of everything on the bar. The behaviour lives
// in bar-spider.ts.

const SNAP_MS = 460;

type Phase = "shown" | "snapping" | "away";

type WebRefs = {
  spokes: SVGPathElement | null;
  rings: SVGPathElement | null;
  torn: SVGPathElement | null;
};

const emptyWeb = (): WebRefs => ({ spokes: null, rings: null, torn: null });

// How far into the page card to look for the bar: the ERP's top bar is a
// child of the card, the MES's header a child of the page inside it.
const BAR_SEARCH_DEPTH = 3;

const EVERYWHERE: Obstacle = {
  left: Number.NEGATIVE_INFINITY,
  top: Number.NEGATIVE_INFINITY,
  right: Number.POSITIVE_INFINITY,
  bottom: Number.POSITIVE_INFINITY
};

/**
 * The top bar is the element in the layer's card, nearest the card, that
 * starts where the layer does and is as tall. Everything on it you can see
 * or press, as boxes in the layer's coordinates.
 */
function findBar(layer: HTMLElement) {
  const card = layer.parentElement;
  if (!card) return null;
  const origin = layer.getBoundingClientRect();
  let level = Array.from(card.children);
  for (let depth = 0; depth < BAR_SEARCH_DEPTH && level.length > 0; depth++) {
    const bar = level.find((element) => {
      if (element === layer) return false;
      const box = element.getBoundingClientRect();
      return (
        Math.abs(box.top - origin.top) < 2 &&
        Math.abs(box.height - origin.height) < 3
      );
    });
    if (bar instanceof HTMLElement) return bar;
    level = level
      .filter((element) => element !== layer)
      .flatMap((element) => Array.from(element.children));
  }
  return null;
}

function measureBar(layer: HTMLElement) {
  const origin = layer.getBoundingClientRect();
  const bar = findBar(layer);
  if (!bar) return null;
  const obstacles: Obstacle[] = [];
  for (const node of Array.from(bar.querySelectorAll("*"))) {
    // Anything pressable whole (links, buttons, fields, focusable or
    // role-carrying elements), and every other element that holds no
    // further elements (text, icons).
    const leaf =
      node.childElementCount === 0 ||
      node.matches(
        "a, button, input, select, textarea, label, summary, [role], [tabindex]"
      );
    if (!leaf) continue;
    const box = node.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) continue;
    obstacles.push({
      left: box.left - origin.left,
      top: box.top - origin.top,
      right: box.right - origin.left,
      bottom: box.bottom - origin.top
    });
  }
  return { bar, obstacles };
}

export function BarSpider({
  revealOpen,
  onOpen,
  onPreload
}: {
  revealOpen: boolean;
  onOpen: () => void;
  onPreload: () => void;
}) {
  const { t } = useLingui();
  const reducedMotion = useReducedMotion() ?? false;
  const [phase, setPhase] = useState<Phase>("shown");
  const [grabbing, setGrabbing] = useState(false);

  const layerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const websRef = useRef<WebRefs[]>([emptyWeb(), emptyWeb()]);
  const draglineRef = useRef<SVGLineElement>(null);
  const bodyRef = useRef<SVGGElement>(null);
  const femursRef = useRef<SVGPathElement>(null);
  const tibiaeRef = useRef<SVGPathElement>(null);
  const tarsiRef = useRef<SVGPathElement>(null);
  const jointsRef = useRef<SVGPathElement>(null);
  const bristlesRef = useRef<SVGPathElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const sim = useRef<ReturnType<typeof createBarSpider> | null>(null);
  if (sim.current === null) sim.current = createBarSpider();

  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  // Wire the simulation to the drawing, size it to the bar, and keep both the
  // size and the bar's contents current: the bar lays out after the first
  // paint, each page has its own breadcrumbs, windows get resized.
  useEffect(() => {
    const s = sim.current;
    const layer = layerRef.current;
    const card = layer?.parentElement;
    if (!s || !layer || !card) return;
    s.attach(
      {
        svg: svgRef.current,
        webs: websRef.current,
        dragline: draglineRef.current,
        body: bodyRef.current,
        femurs: femursRef.current,
        tibiae: tibiaeRef.current,
        tarsi: tarsiRef.current,
        joints: jointsRef.current,
        bristles: bristlesRef.current,
        button: buttonRef.current
      },
      { reducedMotion }
    );

    let frame = 0;
    let watched: Element | null = null;
    const barResized = new ResizeObserver(() => schedule());
    const barChanged = new MutationObserver(() => schedule());
    function measure() {
      if (!layer) return;
      s?.layout(layer.getBoundingClientRect());
      const found = measureBar(layer);
      // No bar found means nothing known to stay clear of: block the whole
      // layer, or the spider would take clicks meant for whatever is under it.
      s?.setObstacles(found?.obstacles ?? [EVERYWHERE]);
      if (!found || found.bar === watched) return;
      barResized.disconnect();
      barChanged.disconnect();
      watched = found.bar;
      barResized.observe(found.bar);
      // An item shown, hidden or moved by a class, a style or its open
      // state changes the boxes as much as one added or removed.
      barChanged.observe(found.bar, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["class", "style", "hidden", "data-state"]
      });
    }
    function schedule() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    }
    const layerResized = new ResizeObserver(schedule);
    layerResized.observe(layer);
    const cardChanged = new MutationObserver(schedule);
    cardChanged.observe(card, { childList: true });
    // Scrolling only moves the layer on the screen: no need to re-measure
    // the bar, just where pointer events land.
    let scrollFrame = 0;
    const onScroll = () => {
      cancelAnimationFrame(scrollFrame);
      scrollFrame = requestAnimationFrame(() =>
        s.layout(layer.getBoundingClientRect())
      );
    };
    window.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true
    });

    measure();
    s.appear();
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(scrollFrame);
      window.removeEventListener("scroll", onScroll, { capture: true });
      barResized.disconnect();
      barChanged.disconnect();
      layerResized.disconnect();
      cardChanged.disconnect();
      s.detach();
    };
  }, [reducedMotion]);

  // The spider comes back once the surprise is closed.
  useEffect(() => {
    if (revealOpen || phase !== "away") return;
    setPhase("shown");
    sim.current?.appear();
  }, [revealOpen, phase]);

  useEffect(() => {
    if (phase !== "snapping") return;
    const timer = window.setTimeout(() => {
      setPhase("away");
      sim.current?.sleep();
      onOpenRef.current();
    }, SNAP_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const letGo = () => {
    sim.current?.release();
    setGrabbing(false);
  };

  const open = () => {
    if (phase !== "shown") return;
    onPreload();
    sim.current?.snap();
    setPhase("snapping");
  };

  const silk = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const
  };

  return (
    <div
      ref={layerRef}
      className="pointer-events-none absolute inset-x-0 top-0 z-20 hidden text-foreground md:block"
      // The ERP's top bar, else the MES's page header.
      style={{ height: "var(--topbar-height, var(--header-height))" }}
    >
      <svg
        ref={svgRef}
        width="100%"
        height={BAR_HEIGHT}
        className={cn(
          "absolute inset-0 overflow-visible transition-opacity ease-out",
          phase === "shown"
            ? "opacity-100 duration-300"
            : "opacity-0 duration-500"
        )}
        aria-hidden
      >
        <defs>
          <filter
            id="halloween-spider-shadow"
            x="-50%"
            y="-50%"
            width="200%"
            height="200%"
          >
            <feDropShadow
              dx="1"
              dy="2"
              stdDeviation="0.9"
              floodColor="#000000"
              floodOpacity="0.28"
            />
          </filter>
        </defs>

        {websRef.current.map((web, k) => {
          const id = `halloween-corner-web-${k}`;
          const at = (name: keyof WebRefs) => (node: SVGPathElement | null) => {
            web[name] = node;
          };
          return (
            <g key={id}>
              <path
                ref={at("spokes")}
                {...silk}
                strokeOpacity={0.22}
                strokeWidth={0.7}
              />
              <path
                ref={at("rings")}
                {...silk}
                strokeOpacity={0.18}
                strokeWidth={0.6}
              />
              <path
                ref={at("torn")}
                {...silk}
                strokeOpacity={0.16}
                strokeWidth={0.5}
              />
            </g>
          );
        })}
        <line
          ref={draglineRef}
          stroke="currentColor"
          strokeOpacity={0.5}
          strokeWidth={0.45}
          visibility="hidden"
        />

        <g filter="url(#halloween-spider-shadow)">
          <g fill="none" stroke={LEG_COLOUR} strokeLinecap="round">
            <path
              ref={bristlesRef}
              stroke="#1c130c"
              strokeOpacity={0.75}
              strokeWidth={0.26}
            />
            <path ref={femursRef} strokeWidth={1.3} />
            <path ref={tibiaeRef} strokeWidth={1} />
            <path ref={tarsiRef} strokeWidth={0.68} />
            <path
              ref={jointsRef}
              stroke={LEG_BAND}
              strokeWidth={0.94}
              strokeLinecap="butt"
            />
          </g>
          <g ref={bodyRef}>
            <RealSpiderBody idPrefix="halloween-bar-spider" />
          </g>
        </g>
      </svg>
      <button
        ref={buttonRef}
        type="button"
        aria-label={t`Halloween surprise`}
        title={t`Poke the spider… if you dare`}
        disabled={phase !== "shown"}
        className={cn(
          "absolute left-0 top-0 rounded-full outline-none touch-none",
          "focus-visible:ring-2 focus-visible:ring-ring",
          grabbing ? "cursor-grabbing" : "cursor-grab"
        )}
        // The simulation switches pointer events on and off as the spider
        // moves, so it never covers anything on the bar.
        style={{ width: HIT_SIZE, height: HIT_SIZE, pointerEvents: "none" }}
        onPointerEnter={onPreload}
        onFocus={onPreload}
        onPointerDown={(event) => {
          // Only the main button grabs: a right-click opens a context menu
          // that swallows the release.
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          sim.current?.grab(event.clientX, event.clientY);
          setGrabbing(true);
        }}
        onPointerMove={(event) => {
          const held = (event.buttons & 1) === 1;
          sim.current?.drag(event.clientX, event.clientY, held);
          if (!held) setGrabbing(false);
        }}
        onPointerUp={letGo}
        onPointerCancel={letGo}
        onLostPointerCapture={letGo}
        onClick={() => {
          // A drag ends in a click too; only a press that stayed put opens.
          if (sim.current?.consumeDrag()) return;
          open();
        }}
      />
    </div>
  );
}
