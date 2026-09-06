/**
 * Carbon Learn — the curriculum.
 *
 * Code-shipped on purpose: the content versions with the product, so a
 * certificate can stamp a real `LEARN_CONTENT_VERSION`, and a docs change that
 * invalidates a question shows up in the same review as the docs edit. A
 * company that wants to author its OWN material already has the Training
 * feature (`resources` -> Training); this is Carbon teaching Carbon.
 *
 * Each track lives in `tracks/<slug>.ts` — a content change to one track then
 * reviews on its own, rather than as a diff buried in a 2,000-line file. This
 * file assembles them and owns every lookup helper.
 *
 * Client-safe: titles, objectives, doc links, and assessment shapes only.
 * Question text and answers live in `banks/*.server.ts`; checker logic in
 * `checkers/*.server.ts`.
 */

import { accounting } from "./tracks/accounting";
import { admin } from "./tracks/admin";
import { fundamentals } from "./tracks/fundamentals";
import { inventory } from "./tracks/inventory";
import { planning } from "./tracks/planning";
import { production } from "./tracks/production";
import { purchasing } from "./tracks/purchasing";
import { quality } from "./tracks/quality";
import { sales } from "./tracks/sales";
import type { LearnChallengeMeta, LearnTrack, LearnUnit } from "./types";

/** Hub order: Fundamentals first, then the role tracks. */
export const learnTracks: LearnTrack[] = [
  fundamentals,
  purchasing,
  accounting,
  sales,
  inventory,
  production,
  planning,
  quality,
  admin
];

export function getTrack(slug: string): LearnTrack | undefined {
  return learnTracks.find((track) => track.slug === slug);
}

export function liveTracks(): LearnTrack[] {
  return learnTracks.filter((track) => track.status === "live");
}

export function trackUnits(track: LearnTrack): LearnUnit[] {
  return track.modules.flatMap((module) => module.units);
}

export function trackUnitCount(track: LearnTrack): number {
  return trackUnits(track).length;
}

export function getUnit(
  trackSlug: string,
  unitSlug: string
): LearnUnit | undefined {
  const track = getTrack(trackSlug);
  if (!track) return undefined;
  return trackUnits(track).find((unit) => unit.slug === unitSlug);
}

export function moduleForUnit(trackSlug: string, unitSlug: string) {
  const track = getTrack(trackSlug);
  if (!track) return undefined;
  return track.modules.find((module) =>
    module.units.some((unit) => unit.slug === unitSlug)
  );
}

export function getChallenge(slug: string): LearnChallengeMeta | undefined {
  for (const track of learnTracks) {
    const challenge = track.challenges.find((c) => c.slug === slug);
    if (challenge) return challenge;
  }
  return undefined;
}

/** The unit whose assessment IS this challenge — used to mark progress on a pass. */
export function unitForChallenge(challengeSlug: string) {
  for (const track of learnTracks) {
    for (const module of track.modules) {
      for (const unit of module.units) {
        if (
          unit.assessment.kind === "challenge" &&
          unit.assessment.challengeSlug === challengeSlug
        ) {
          return { track, module, unit };
        }
      }
    }
  }
  return undefined;
}
