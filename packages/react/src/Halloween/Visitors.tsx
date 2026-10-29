// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bat } from "./Bat";
import type { Flight } from "./flight";
import { approach, crossing, takeOff } from "./flight";
import { onToast } from "./toasts";

// Bats that pass through now and then while Halloween is on: a few across
// the screen every few minutes, and a few out of a success toast. Each flies
// its own erratic path (flight.ts), so a group never moves in step. They draw
// over the page, are hidden from assistive technology and take no clicks. A
// reduced-motion user gets none of them, and a hidden tab skips its turn.

const BAT_VIEWBOX = "-62 -26 124 42";

type Flier = {
  key: number;
  flight: Flight;
  duration: number;
  delay: number;
  flap: number;
};

function FlyingBat({
  bat,
  size,
  onDone
}: {
  bat: Flier;
  size: number;
  onDone?: () => void;
}) {
  const { flight } = bat;
  return (
    <motion.svg
      viewBox={BAT_VIEWBOX}
      width={size}
      height={(size * 42) / 124}
      className="absolute overflow-visible"
      style={{ left: -size / 2, top: -(size * 21) / 124 }}
      initial={{
        x: flight.x[0],
        y: flight.y[0],
        rotate: flight.rotate[0],
        scale: flight.scale[0],
        opacity: flight.opacity[0]
      }}
      animate={flight}
      transition={{ duration: bat.duration, delay: bat.delay, ease: "linear" }}
      onAnimationComplete={onDone}
    >
      <Bat silhouette={false} flap={bat.flap} />
    </motion.svg>
  );
}

type Colony = { id: number; bats: Flier[] };

function newColony(id: number): Colony {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const leftToRight = Math.random() < 0.5;
  // Usually one bat; now and then a few, loosely together.
  const roll = Math.random();
  const count = roll < 0.55 ? 1 : roll < 0.8 ? 2 : roll < 0.93 ? 3 : 4;
  return {
    id,
    bats: Array.from({ length: count }, (_, key) => {
      const atViewer = Math.random() < 0.3;
      const flight = atViewer
        ? approach(width, height, Math.random)
        : crossing(width, height, leftToRight, Math.random);
      return {
        key,
        flight,
        duration: atViewer
          ? 2.4 + Math.random() * 1.2
          : (width + 220) / (170 + Math.random() * 120),
        delay: key === 0 ? 0 : 0.3 + Math.random() * 2.6,
        flap: 0.16 + Math.random() * 0.1
      };
    })
  };
}

/** Bats crossing or swooping at the viewer every two to five minutes. */
export function BatFlyby() {
  const still = useReducedMotion() ?? false;
  const [colony, setColony] = useState<Colony | null>(null);
  const landed = useRef(0);

  useEffect(() => {
    if (still) return;
    let timer = 0;
    let id = 0;
    const schedule = (delay: number) => {
      timer = window.setTimeout(() => {
        if (document.visibilityState === "visible") {
          id += 1;
          landed.current = 0;
          setColony(newColony(id));
        }
        schedule(120_000 + Math.random() * 180_000);
      }, delay);
    };
    schedule(25_000 + Math.random() * 25_000);
    return () => window.clearTimeout(timer);
  }, [still]);

  if (!colony) return null;
  const done = () => {
    landed.current += 1;
    if (landed.current >= colony.bats.length) setColony(null);
  };

  return createPortal(
    <div
      key={colony.id}
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-40 h-0 w-0 drop-shadow-[0_10px_12px_rgb(0_0_0/0.16)]"
    >
      {colony.bats.map((bat) => (
        <FlyingBat key={bat.key} bat={bat} size={58} onDone={done} />
      ))}
    </div>,
    document.body
  );
}

// At most one burst this often, so a run of saves is not a swarm.
const BURST_GAP_MS = 12_000;

type Burst = { id: number; x: number; y: number; bats: Flier[] };

/** A few bats taking off from a success toast as it appears. */
export function SuccessBats() {
  const still = useReducedMotion() ?? false;
  const [bursts, setBursts] = useState<Burst[]>([]);
  const lastBurst = useRef(Number.NEGATIVE_INFINITY);

  useEffect(() => {
    if (still) return;
    let id = 0;
    const timers = new Set<number>();
    const stop = onToast("success", (toast) => {
      if (performance.now() - lastBurst.current < BURST_GAP_MS) return;
      lastBurst.current = performance.now();
      // Once the toast has slid into place.
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        const box = toast.getBoundingClientRect();
        if (box.width === 0) return;
        id += 1;
        const count =
          3 + (Math.random() < 0.5 ? 1 : 0) + (Math.random() < 0.5 ? 1 : 0);
        const burst: Burst = {
          id,
          x: box.left + box.width * (0.3 + Math.random() * 0.4),
          y: box.top + 8,
          bats: Array.from({ length: count }, (_, key) => ({
            key,
            flight: takeOff(Math.random),
            duration: 1.5 + Math.random() * 0.9,
            delay: Math.random() * 0.45,
            flap: 0.13 + Math.random() * 0.07
          }))
        };
        setBursts((current) => [...current, burst]);
      }, 380);
      timers.add(timer);
    });
    return () => {
      stop();
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [still]);

  if (bursts.length === 0) return null;
  return createPortal(
    bursts.map((burst) => (
      <BatBurst
        key={burst.id}
        burst={burst}
        onDone={() =>
          setBursts((current) => current.filter((b) => b.id !== burst.id))
        }
      />
    )),
    document.body
  );
}

function BatBurst({ burst, onDone }: { burst: Burst; onDone: () => void }) {
  const landed = useRef(0);
  const done = () => {
    landed.current += 1;
    if (landed.current >= burst.bats.length) onDone();
  };
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed z-[1000] h-0 w-0 drop-shadow-[0_8px_10px_rgb(0_0_0/0.16)]"
      style={{ left: burst.x, top: burst.y }}
    >
      {burst.bats.map((bat) => (
        <FlyingBat key={bat.key} bat={bat} size={40} onDone={done} />
      ))}
    </div>
  );
}
