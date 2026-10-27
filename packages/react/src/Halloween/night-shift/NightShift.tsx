// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The Night Shift on a canvas: fills its positioned parent, runs at 24 fps,
// pauses with the tab, and watches the sign-in form so the cast can react
// (with reduced motion it draws one still frame and watches nothing).
// The story resumes from the next shift on the next visit in the same
// browser session, so the hill keeps the lanterns it has earned.

import { useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { onToast } from "../toasts";
import type { Buffers } from "./frame";
import { makeBuffers, renderFrame } from "./frame";
import type { Layout } from "./layout";
import { makeLayout } from "./layout";
import type { Metrics } from "./paint";
import { paint } from "./paint";
import type { Labels, Watcher } from "./scene";
import { IDLE_WATCHER } from "./scene";
import type { Moment, ShiftPlan } from "./story";
import { actStart, momentAt, planShift } from "./story";

const FONT_FAMILY =
  '"Geist Mono Variable", "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
/** Glyph size grows with the panel, so the scene fills it at any width. */
function fontFor(width: number) {
  const px = Math.max(12, Math.min(16, width / 52));
  return { px, line: Math.trunc(px * 1.17 + 0.5) };
}
const FPS = 24;
const SESSION_KEY = "carbon:night-shift";

type Saved = { seed: number; shift: number };

function readSaved(): Saved {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (raw) {
      const value: unknown = JSON.parse(raw);
      if (
        value &&
        typeof value === "object" &&
        "seed" in value &&
        "shift" in value &&
        typeof value.seed === "number" &&
        typeof value.shift === "number"
      ) {
        return { seed: value.seed, shift: value.shift };
      }
    }
  } catch {
    // Storage can be off (private mode); the story just starts over.
  }
  const seed = window.crypto.getRandomValues(new Uint32Array(1))[0] ?? 1;
  return { seed, shift: 0 };
}

function writeSaved(saved: Saved) {
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(saved));
  } catch {
    // Not saved: the next visit starts a new story.
  }
}

/** The one frame shown to someone who prefers reduced motion. */
function stillMoment(shift: number): Moment {
  // Late in Shipping: the procession lit, the ghost out, the door open.
  return momentAt(actStart("shipping") + 14, shift);
}

function fade(sinceSeconds: number, lasts: number) {
  if (sinceSeconds < 0 || sinceSeconds > lasts) return 0;
  return 1 - sinceSeconds / lasts;
}

function readFocus(watcher: Watcher) {
  const active = document.activeElement;
  watcher.field = false;
  watcher.secret = false;
  watcher.peek = false;
  if (
    !(
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement
    )
  )
    return;
  const hidden =
    active instanceof HTMLInputElement && active.type === "password";
  const named =
    /\b(password|otp|code|pin)\b/i.test(active.name) ||
    active.autocomplete === "one-time-code";
  watcher.secret = hidden || named;
  watcher.peek =
    !hidden &&
    active instanceof HTMLInputElement &&
    active.type === "text" &&
    /password/i.test(active.name);
  watcher.field = !watcher.secret;
}

export default function NightShift() {
  const { t } = useLingui();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const words: Labels = {
    stations: [t`Wash`, t`Carve`, t`Light up`, t`QC`],
    item: t`Jack-o'-lantern`,
    inProgress: t`In Progress`,
    complete: t`Completed`,
    scrapped: t`Scrapped`,
    passed: t`QC passed`,
    rejected: t`Rejected`
  };
  // Read by every frame, so a language change shows on the next one.
  const labels = useRef(words);
  labels.current = words;
  // Frame callbacks and observers are out of the error boundary's reach, so a
  // draw that throws is rethrown here, during render.
  const [crash, setCrash] = useState<{ error: unknown } | null>(null);
  if (crash) throw crash.error;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const host = canvas?.parentElement;
    if (!canvas || !ctx || !host) return;

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const saved = readSaved();
    writeSaved({ seed: saved.seed, shift: saved.shift + 1 });
    const plans = new Map<number, ShiftPlan>();
    const planFor = (index: number) => {
      let plan = plans.get(index);
      if (!plan) {
        plan = planShift(saved.seed, index);
        plans.set(index, plan);
      }
      return plan;
    };

    const watcher: Watcher = { ...IDLE_WATCHER };
    let layout: Layout | null = null;
    let buffers: Buffers | null = null;
    let metrics: Metrics | null = null;
    let clock = 0;
    let last = performance.now();
    let lastShift = saved.shift;
    let flareAt = Number.NEGATIVE_INFINITY;
    let alarmAt = Number.NEGATIVE_INFINITY;
    let disposed = false;
    let frameId = 0;

    const measure = () => {
      const { width, height } = host.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.trunc(width * ratio);
      canvas.height = Math.trunc(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const size = fontFor(width);
      const font = `${size.px}px ${FONT_FAMILY}`;
      ctx.font = font;
      const cellWidth = ctx.measureText("M".repeat(100)).width / 100;
      const cols = Math.trunc(width / cellWidth);
      const rows = Math.trunc(height / size.line);
      layout = makeLayout(cols, rows, size.line / cellWidth);
      buffers = makeBuffers(cols, rows);
      metrics = {
        cellWidth,
        cellHeight: size.line,
        offsetX: (width - cols * cellWidth) / 2,
        offsetY: (height - rows * size.line) / 2,
        font,
        width,
        height,
        horizonRow: layout.horizon
      };
    };

    const draw = () => {
      if (disposed || !layout || !buffers || !metrics) return;
      try {
        const moment = still
          ? stillMoment(saved.shift)
          : momentAt(clock, saved.shift);
        if (moment.shift !== lastShift) {
          lastShift = moment.shift;
          writeSaved({ seed: saved.seed, shift: moment.shift + 1 });
        }
        readFocus(watcher);
        watcher.flare = fade(clock - flareAt, 1.4);
        watcher.alarm = fade(clock - alarmAt, 2.4);
        const frame = renderFrame(
          buffers,
          layout,
          planFor(moment.shift),
          moment,
          clock,
          watcher,
          labels.current
        );
        paint(ctx, buffers.main, frame, metrics);
      } catch (error) {
        disposed = true;
        setCrash({ error });
      }
    };

    const tick = (now: number) => {
      if (disposed) return;
      const delta = now - last;
      if (delta >= 1000 / FPS - 2) {
        last = now;
        // A hidden tab gets no frames; pick the story up where it was.
        clock += Math.min(delta, 250) / 1000;
        draw();
      }
      frameId = window.requestAnimationFrame(tick);
    };

    const redraw = () => {
      measure();
      draw();
    };
    redraw();
    void document.fonts?.load(`14px ${FONT_FAMILY}`).then(() => {
      if (!disposed) redraw();
    });
    const resize = new ResizeObserver(redraw);
    resize.observe(host);
    // One still frame: nothing moves, so nothing needs to react.
    if (still) {
      return () => {
        disposed = true;
        resize.disconnect();
      };
    }
    frameId = window.requestAnimationFrame(tick);

    const onPointer = (event: PointerEvent) => {
      if (!metrics) return;
      const rect = canvas.getBoundingClientRect();
      watcher.pointer = {
        x: (event.clientX - rect.left - metrics.offsetX) / metrics.cellWidth,
        y: (event.clientY - rect.top - metrics.offsetY) / metrics.cellHeight
      };
    };
    const onLeave = () => {
      watcher.pointer = null;
    };
    const onSubmit = () => {
      flareAt = clock;
    };
    const stopToasts = onToast("error", () => {
      alarmAt = clock;
    });
    window.addEventListener("pointermove", onPointer, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    document.addEventListener("submit", onSubmit, true);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frameId);
      resize.disconnect();
      stopToasts();
      window.removeEventListener("pointermove", onPointer);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="absolute inset-0 h-full w-full"
    />
  );
}
