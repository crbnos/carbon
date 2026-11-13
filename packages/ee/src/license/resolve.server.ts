// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { getEnv } from "@carbon/env";
import { getLogger } from "@carbon/logger";
import { datetime, normalizePlanId } from "@carbon/utils";
import { parseAbsolute } from "@internationalized/date";
import { FEATURE_PLANS, type Feature } from "../plan";
import type { ResolvedLicence } from "./entitlement";
import { licenceRoots } from "./roots";
import {
  EMPTY_STORED,
  readStoredLicence,
  type StoredLicence,
  updateStoredLicence
} from "./store.server";
import type {
  LicenceView,
  RootKey,
  VerifyContext,
  VerifyInput,
  VerifyOutput
} from "./types";
import { verify } from "./verifier.server";

const logger = getLogger("ee", "licence");

export { loadVerifier } from "./verifier.server";

const CACHE_MS = 60_000;

type Verified = Extract<VerifyOutput, { ok: true }>;

/** The licence in use, for the check-in request. Never sent to a browser. */
export type LicenceInUse = {
  key: string;
  sealed: string;
  signedLicense: unknown;
  checkInUrl: string | null;
  view: LicenceView;
};

/** crbn.v1.<key>.<sealed> → its parts. */
export function splitLicence(
  licence: string
): { key: string; sealed: string } | null {
  const s = licence.replace(/\s+/g, "");
  if (!s.startsWith("crbn.v1.")) return null;
  const rest = s.slice("crbn.v1.".length);
  const dot = rest.indexOf(".");
  if (dot <= 0) return null;
  return { key: rest.slice(0, dot), sealed: `crbn.v1.${rest.slice(dot + 1)}` };
}

/**
 * Whether `candidate` is a later issue of the same licence as `base`. False
 * when either date does not parse: a bad stored value never wins.
 */
function supersedes(
  licenseId: string | null,
  issuedAt: string | null,
  base: LicenceView
): boolean {
  if (licenseId !== base.license_id || !issuedAt) return false;
  try {
    return (
      parseAbsolute(issuedAt, "UTC").compare(
        parseAbsolute(base.issued_at, "UTC")
      ) > 0
    );
  } catch {
    return false;
  }
}

function checkInOf(stored: StoredLicence): ResolvedLicence["checkIn"] {
  return {
    lastAt: stored.lastCheckInAt,
    status: stored.lastCheckInStatus,
    error: stored.lastCheckInError,
    seatsUsed: stored.seatsUsed
  };
}

function floor(error: string, stored: StoredLicence): ResolvedLicence {
  return {
    kind: "floor",
    status: "none",
    plan: null,
    overrides: {},
    error,
    licence: null,
    clockSuspect: stored.state.clock_suspect,
    checkIn: checkInOf(stored)
  };
}

function toResolution(out: Verified, stored: StoredLicence): ResolvedLicence {
  const view = out.license;
  const overrides: Partial<Record<Feature, boolean>> = {};
  for (const [feature, on] of Object.entries(view.overrides ?? {})) {
    if (feature in FEATURE_PLANS) overrides[feature as Feature] = on;
  }
  return {
    kind: "licence",
    status: out.status,
    plan: view.plan_id ? normalizePlanId(view.plan_id) : null,
    overrides,
    error: null,
    licence: view,
    clockSuspect: out.state.clock_suspect,
    checkIn: checkInOf(stored)
  };
}

export type ResolverDeps = {
  licence: () => string;
  verify: (input: VerifyInput) => Promise<VerifyOutput>;
  /** A fresh copy each call: the resolver updates it in place. */
  readStored: () => Promise<StoredLicence>;
  updateStored: (patch: Partial<StoredLicence>) => Promise<unknown>;
  roots: () => RootKey[];
  /** RFC 3339 now, for the verifier. */
  now: () => string;
  /** A monotonic clock in milliseconds, for the cache. */
  ms: () => number;
};

/**
 * Resolves this install's licence. One instance per process holds the
 * licence in use, the last good answer and the 60 s cache.
 */
export class LicenceResolver {
  private cached: { at: number; value: ResolvedLicence } | null = null;
  private pending: Promise<ResolvedLicence> | null = null;
  private lastGood: ResolvedLicence | null = null;
  private inUse: LicenceInUse | null = null;
  private installedFrom: string | null = null;
  private lastLogged = "";
  private readonly loggedErrors = new Set<string>();

  constructor(private readonly deps: ResolverDeps) {}

  clearCache(): void {
    this.cached = null;
  }

  licenceInUse(): LicenceInUse | null {
    return this.inUse;
  }

  /**
   * The verified licence, cached in memory for 60 s. Never throws: a failure
   * gives the last good resolution, else the floor.
   */
  resolve(): Promise<ResolvedLicence> {
    const at = this.deps.ms();
    if (this.cached && at - this.cached.at < CACHE_MS) {
      return Promise.resolve(this.cached.value);
    }
    // One resolution at a time: a page load asks for every feature at once.
    this.pending ??= this.refresh(at).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async refresh(at: number): Promise<ResolvedLicence> {
    let value: ResolvedLicence;
    try {
      value = await this.compute();
    } catch (error) {
      logger.error("licence: resolution failed", { error });
      value = this.lastGood ?? floor("unavailable", EMPTY_STORED);
    }
    this.logChange(value);
    this.cached = { at, value };
    return value;
  }

  private async compute(): Promise<ResolvedLicence> {
    const licence = this.deps.licence().trim();
    const stored = await this.deps.readStored();

    if (!licence) return floor("missing", stored);

    const parts = splitLicence(licence);
    let out: VerifyOutput;
    if (!parts) {
      out = await this.run({ license: licence }, stored, "install");
    } else if (this.installedFrom !== licence || !this.inUse) {
      out = await this.install(licence, parts, stored);
      if (out.ok) this.installedFrom = licence;
    } else {
      out = await this.recheck(this.inUse, stored);
    }

    if (!out.ok) {
      if (!this.loggedErrors.has(out.error)) {
        this.loggedErrors.add(out.error);
        logger.error("licence: verification failed", { error: out.error });
      }
      return this.lastGood ?? floor(out.error, stored);
    }

    if (stored.revokedLicenseId === out.license.license_id) {
      this.lastGood = null;
      return floor("revoked", stored);
    }

    const value = toResolution(out, stored);
    this.lastGood = value;
    return value;
  }

  private async run(
    input: { license: string } | { sealed: string; key: string },
    stored: StoredLicence,
    context: VerifyContext
  ): Promise<VerifyOutput> {
    const out = await this.deps.verify({
      ...input,
      roots: this.deps.roots(),
      state: stored.state,
      now: this.deps.now(),
      context
    });
    // The verifier commits state at fixed points, success or failure.
    stored.state = out.state;
    await this.deps.updateStored({ state: out.state });
    return out;
  }

  private remember(out: Verified, key: string, sealed: string) {
    this.inUse = {
      key,
      sealed,
      signedLicense: out.signed_license,
      checkInUrl: out.check_in_url ?? null,
      view: out.license
    };
  }

  /**
   * Startup: CARBON_LICENSE seeds an empty store and never overrides a
   * newer renewal. A connected licence's original token
   * ends three weeks after issue while its renewals live on, so a stored
   * renewal is tried even when CARBON_LICENSE itself no longer verifies.
   * It must open with the CARBON_LICENSE key, which belongs to one grant.
   */
  private async install(
    licence: string,
    parts: { key: string; sealed: string },
    stored: StoredLicence
  ): Promise<VerifyOutput> {
    const fromConfig = await this.run({ license: licence }, stored, "install");
    const config = fromConfig.ok ? fromConfig.license : null;

    const sealed =
      stored.sealed &&
      stored.sealed !== parts.sealed &&
      (!config || supersedes(stored.licenseId, stored.issuedAt, config))
        ? stored.sealed
        : null;
    if (sealed) {
      // Stored, so already install-verified when it arrived.
      const renewal = await this.run(
        { sealed, key: parts.key },
        stored,
        "resolve"
      );
      if (
        renewal.ok &&
        (!config ||
          supersedes(
            renewal.license.license_id,
            renewal.license.issued_at,
            config
          ))
      ) {
        this.remember(renewal, parts.key, sealed);
        return renewal;
      }
    }

    if (!fromConfig.ok) return fromConfig;
    await this.deps.updateStored({
      sealed: parts.sealed,
      licenseId: fromConfig.license.license_id,
      issuedAt: fromConfig.license.issued_at
    });
    this.remember(fromConfig, parts.key, parts.sealed);
    return fromConfig;
  }

  /** Later calls: resolve-verify the licence in use, or a newer renewal. */
  private async recheck(
    current: LicenceInUse,
    stored: StoredLicence
  ): Promise<VerifyOutput> {
    const renewal =
      stored.sealed &&
      stored.sealed !== current.sealed &&
      supersedes(stored.licenseId, stored.issuedAt, current.view)
        ? stored.sealed
        : null;

    if (renewal) {
      const out = await this.run(
        { sealed: renewal, key: current.key },
        stored,
        "resolve"
      );
      if (out.ok && out.license.license_id === current.view.license_id) {
        this.remember(out, current.key, renewal);
        return out;
      }
    }
    const out = await this.run(
      { sealed: current.sealed, key: current.key },
      stored,
      "resolve"
    );
    if (out.ok) this.remember(out, current.key, current.sealed);
    return out;
  }

  private logChange(value: ResolvedLicence) {
    const line =
      value.kind === "licence"
        ? `licence: ${value.status}, plan ${value.plan ?? "none"}, expires ${value.licence?.expires_at ?? "never"}`
        : `licence: none (${value.error}) — Community floor`;
    if (line !== this.lastLogged) {
      this.lastLogged = line;
      logger.info(line);
    }
  }
}

export const licenceResolver = new LicenceResolver({
  licence: () => getEnv("CARBON_LICENSE") ?? "",
  verify,
  readStored: readStoredLicence,
  updateStored: updateStoredLicence,
  roots: licenceRoots,
  now: () => datetime.now("UTC").toAbsoluteString(),
  ms: () => performance.now()
});

export const resolveLicence = () => licenceResolver.resolve();
