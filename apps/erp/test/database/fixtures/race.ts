// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs racing operations at once, each on its own connection, round after
// round: a held lock forces one known interleaving, this tries many on the
// real database.

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { connectLocalTestDatabase } from "./local-database";

/** What one operation of a round did. A refusal is an outcome, never a failure of the round. */
export type Outcome =
  | { ok: true; value: unknown }
  | { ok: false; error: string; code: string | null };

type Operation<State> = (
  db: Kysely<KyselyDatabase>,
  state: State
) => Promise<unknown>;

/** `rounds`, or RACE_ROUNDS when it is set: CI raises it to try more interleavings. */
export function raceRounds(rounds: number): number {
  const override = Number(process.env.RACE_ROUNDS);
  return Number.isInteger(override) && override > 0 ? override : rounds;
}

/** A test timeout for `rounds` rounds of about `perRoundMs` each. */
export function raceTimeout(rounds: number, perRoundMs: number): number {
  return 30_000 + rounds * perRoundMs * 2;
}

/**
 * For each round: `setup` builds fresh state, every operation starts at the
 * same moment (each after its own random 0–`maxDelayMs` ms delay) on its own
 * connection, and `invariant` checks the state once all have settled. An
 * operation's `{ error }` result or throw is recorded as a refusal. A broken
 * invariant throws with the round and each operation's delay, finishing order
 * and outcome, so the failing interleaving is visible.
 */
export async function race<State, Name extends string>({
  operations,
  rounds,
  setup,
  invariant,
  maxDelayMs = 5
}: {
  operations: Record<Name, Operation<State>>;
  rounds: number;
  setup: (round: number) => Promise<State>;
  invariant: (
    state: State,
    outcomes: Record<Name, Outcome>
  ) => void | Promise<void>;
  maxDelayMs?: number;
}): Promise<Record<Name, { ok: number; refused: number }>> {
  const names = Object.keys(operations) as Name[];
  const tally = Object.fromEntries(
    names.map((name) => [name, { ok: 0, refused: 0 }])
  ) as Record<Name, { ok: number; refused: number }>;
  const connections: Kysely<KyselyDatabase>[] = [];
  try {
    for (const _ of names) connections.push(await connectLocalTestDatabase());
    for (let round = 1; round <= rounds; round++) {
      const state = await setup(round);
      const delays = names.map(() =>
        Math.floor(Math.random() * (maxDelayMs + 1))
      );
      const finished: Name[] = [];
      const settled = await Promise.all(
        names.map(async (name, i) => {
          await new Promise((resolve) => setTimeout(resolve, delays[i]));
          const outcome = await outcomeOf(() =>
            operations[name](connections[i]!, state)
          );
          finished.push(name);
          return outcome;
        })
      );
      const outcomes = Object.fromEntries(
        names.map((name, i) => [name, settled[i]!])
      ) as Record<Name, Outcome>;
      for (const name of names) {
        tally[name][outcomes[name].ok ? "ok" : "refused"]++;
      }
      try {
        await invariant(state, outcomes);
      } catch (broken) {
        const lines = names.map((name, i) => {
          const outcome = outcomes[name];
          return `  ${name}: started +${delays[i]}ms, finished #${
            finished.indexOf(name) + 1
          }, ${
            outcome.ok
              ? "ok"
              : `refused${outcome.code ? ` [${outcome.code}]` : ""}: ${outcome.error}`
          }`;
        });
        throw new Error(
          `Round ${round} of ${rounds} broke the invariant:\n${lines.join("\n")}\n${
            broken instanceof Error ? broken.message : String(broken)
          }`,
          { cause: broken }
        );
      }
    }
    // RACE_VERBOSE shows how often each operation won or was refused: a race
    // whose outcomes never vary tried one interleaving.
    if (process.env.RACE_VERBOSE) console.log(JSON.stringify(tally));
    return tally;
  } finally {
    for (const db of connections) await db.destroy();
  }
}

/** The operations that failed on a deadlock (SQLSTATE 40P01). */
export function deadlocked<Name extends string>(
  outcomes: Record<Name, Outcome>
): Name[] {
  return (Object.keys(outcomes) as Name[]).filter((name) => {
    const outcome = outcomes[name];
    return (
      !outcome.ok &&
      (outcome.code === "40P01" || /deadlock detected/i.test(outcome.error))
    );
  });
}

async function outcomeOf(run: () => Promise<unknown>): Promise<Outcome> {
  try {
    const value = await run();
    const refusal =
      value && typeof value === "object" && "error" in value
        ? (value as { error: unknown }).error
        : null;
    return refusal ? failureOf(refusal) : { ok: true, value };
  } catch (thrown) {
    return failureOf(thrown);
  }
}

/** A refusal's message and a database failure's SQLSTATE, which a posting keeps on its blanked error's cause. */
function failureOf(error: unknown): Outcome {
  const e = error as {
    message?: string;
    code?: unknown;
    cause?: { code?: unknown; message?: string };
  } | null;
  const code =
    typeof e?.code === "string"
      ? e.code
      : typeof e?.cause?.code === "string"
        ? e.cause.code
        : null;
  const message =
    e?.message ||
    e?.cause?.message ||
    (typeof error === "string" ? error : JSON.stringify(error));
  return { ok: false, error: message ?? "failed", code };
}
