// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { getEnv } from "@carbon/env";
import { getLogger } from "@carbon/logger";
import { normalizePlanId, type Plan } from "@carbon/utils";
import { now, parseAbsolute } from "@internationalized/date";
import { FEATURE_PLANS, type Feature } from "../plan";
import { licenceRoots } from "./roots";
import {
  EMPTY_STORED,
  readStoredLicence,
  type StoredLicence,
  updateStoredLicence
} from "./store.server";
import type {
  LicenceStatus,
  LicenceView,
  RootKey,
  VerifyContext,
  VerifyInput,
  VerifyOutput
} from "./types";
import { verify } from "./verifier.server";

const logger = getLogger("ee", "licence");

export { LICENCE_ENFORCED } from "./entitlement";
export { loadVerifier } from "./verifier.server";

const CACHE_MS = 60_000;

type Verified = Extract<VerifyOutput, { ok: true }>;

export type LicenceResolution = {
  kind: "licence" | "floor";
  status: LicenceStatus | "none";
  plan: Plan | null;
  overrides: Partial<Record<Feature, boolean>>;
  error: string | null;
  licence: LicenceView | null;
  clockSuspect: boolean;
  checkIn: {
    lastAt: string | null;
    status: string | null;
    error: string | null;
    seatsUsed: number | null;
  };
};

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

/** False when either date does not parse: a bad stored value never wins. */
function isNewer(a: string | null, b: string): boolean {
  if (!a) return false;
  try {
    return parseAbsolute(a, "UTC").compare(parseAbsolute(b, "UTC")) > 0;
  } catch {
    return false;
  }
}

function checkInOf(stored: StoredLicence | null): LicenceResolution["checkIn"] {
  return {
    lastAt: stored?.lastCheckInAt ?? null,
    status: stored?.lastCheckInStatus ?? null,
    error: stored?.lastCheckInError ?? null,
    seatsUsed: stored?.seatsUsed ?? null
  };
}

function floor(error: string, stored: StoredLicence | null): LicenceResolution {
  return {
    kind: "floor",
    status: "none",
    plan: null,
    overrides: {},
    error,
    licence: null,
    clockSuspect: stored?.state.clock_suspect ?? false,
    checkIn: checkInOf(stored)
  };
}

function toResolution(
  out: Verified,
  stored: StoredLicence | null
): LicenceResolution {
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
  readStored: () => Promise<StoredLicence | null>;
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
  private cached: { at: number; value: LicenceResolution } | null = null;
  private pending: Promise<LicenceResolution> | null = null;
  private lastGood: LicenceResolution | null = null;
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
  resolve(): Promise<LicenceResolution> {
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

  private async refresh(at: number): Promise<LicenceResolution> {
    let value: LicenceResolution;
    try {
      value = await this.compute();
    } catch (error) {
      logger.error("licence: resolution failed", { error });
      value = this.lastGood ?? floor("unavailable", null);
    }
    this.logChange(value);
    this.cached = { at, value };
    return value;
  }

  private async compute(): Promise<LicenceResolution> {
    const licence = this.deps.licence().trim();
    const stored = await this.deps.readStored();
    const working: StoredLicence = { ...EMPTY_STORED, ...stored };

    if (!licence) return floor("missing", stored);

    const parts = splitLicence(licence);
    let out: VerifyOutput;
    if (!parts) {
      out = await this.run({ license: licence }, working, "install");
    } else if (this.installedFrom !== licence || !this.inUse) {
      out = await this.install(licence, parts, working);
      if (out.ok) this.installedFrom = licence;
    } else {
      out = await this.recheck(this.inUse, working);
    }

    if (!out.ok) {
      if (!this.loggedErrors.has(out.error)) {
        this.loggedErrors.add(out.error);
        logger.error("licence: verification failed", { error: out.error });
      }
      return this.lastGood ?? floor(out.error, stored);
    }

    if (stored?.revokedLicenseId === out.license.license_id) {
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

    const tryRenewal =
      !!stored.sealed &&
      stored.sealed !== parts.sealed &&
      (!config ||
        (stored.licenseId === config.license_id &&
          isNewer(stored.issuedAt, config.issued_at)));
    if (tryRenewal && stored.sealed) {
      // Stored, so already install-verified when it arrived.
      const renewal = await this.run(
        { sealed: stored.sealed, key: parts.key },
        stored,
        "resolve"
      );
      if (
        renewal.ok &&
        (!config ||
          (renewal.license.license_id === config.license_id &&
            isNewer(renewal.license.issued_at, config.issued_at)))
      ) {
        this.remember(renewal, parts.key, stored.sealed);
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
      stored.licenseId === current.view.license_id &&
      isNewer(stored.issuedAt, current.view.issued_at)
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

  private logChange(value: LicenceResolution) {
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
  now: () => now("UTC").toAbsoluteString(),
  ms: () => performance.now()
});

export const resolveLicence = () => licenceResolver.resolve();
export const clearLicenceCache = () => licenceResolver.clearCache();
export const getLicenceInUse = () => licenceResolver.licenceInUse();
