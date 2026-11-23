// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/** A step the actor cannot take yet: it waits on a lock another actor holds. */
export const BLOCKED = Symbol("blocked");

class Halted<S> {
  constructor(readonly state: S) {}
}

/** The actor's last step: it refused, rolled back or returned early. */
export function halt<S>(state: S): Halted<S> {
  return new Halted(state);
}

export type Step<S> = {
  label: string;
  run(state: S): S | Halted<S> | typeof BLOCKED;
};

/** One request, job or trigger: its atomic steps in program order. */
export type Actor<S> = { name: string; steps: Step<S>[] };

export type Model<S> = {
  init: S;
  actors: Actor<S>[];
  invariants: Record<string, (state: S) => boolean>;
};

export type Violation<S> = {
  invariant: string;
  /** The interleaving that reaches it, as "Actor: step" lines. */
  trace: string[];
  state: S;
};

export type Exploration<S> =
  | { ok: true; states: number }
  | { ok: false; states: number; violation: Violation<S> };

type Node<S> = { shared: S; pc: number[] };

/**
 * Breadth-first over every interleaving of the actors' steps, so the first
 * violation found has the shortest trace. A state where an actor is
 * unfinished and every unfinished actor is blocked is a deadlock.
 */
export function explore<S>(model: Model<S>, limit = 2_000_000): Exploration<S> {
  const check = (state: S, trace: string[]): Violation<S> | null => {
    for (const [invariant, holds] of Object.entries(model.invariants)) {
      if (!holds(state)) return { invariant, trace, state };
    }
    return null;
  };

  const start: Node<S> = { shared: model.init, pc: model.actors.map(() => 0) };
  const initial = check(start.shared, []);
  if (initial) return { ok: false, states: 1, violation: initial };

  const seen = new Set<string>([JSON.stringify(start)]);
  let frontier: { node: Node<S>; trace: string[] }[] = [
    { node: start, trace: [] }
  ];

  while (frontier.length > 0) {
    const next: typeof frontier = [];
    for (const { node, trace } of frontier) {
      let unfinished = 0;
      let moved = false;
      model.actors.forEach((actor, i) => {
        const pc = node.pc[i] ?? actor.steps.length;
        const step = actor.steps[pc];
        if (!step) return;
        unfinished++;
        const result = step.run(node.shared);
        if (result === BLOCKED) return;
        moved = true;
        const pcs = [...node.pc];
        pcs[i] = result instanceof Halted ? actor.steps.length : pc + 1;
        const child: Node<S> = {
          shared: result instanceof Halted ? result.state : result,
          pc: pcs
        };
        const key = JSON.stringify(child);
        if (seen.has(key)) return;
        seen.add(key);
        if (seen.size > limit) {
          throw new Error(`State space exceeds ${limit} states`);
        }
        next.push({
          node: child,
          trace: [...trace, `${actor.name}: ${step.label}`]
        });
      });
      if (unfinished > 0 && !moved) {
        return {
          ok: false,
          states: seen.size,
          violation: { invariant: "no deadlock", trace, state: node.shared }
        };
      }
    }
    for (const { node, trace } of next) {
      const violation = check(node.shared, trace);
      if (violation) return { ok: false, states: seen.size, violation };
    }
    frontier = next;
  }
  return { ok: true, states: seen.size };
}
