// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { randomBytes } from "node:crypto";
import { CarbonEdition, getEnv } from "@carbon/env";
import { acquireLease, type LeaseAcquisition, releaseLease } from "@carbon/kv";
import { getLogger } from "@carbon/logger";
import { Edition } from "@carbon/utils";
import {
  now,
  parseAbsolute,
  type ZonedDateTime
} from "@internationalized/date";
import { getInstallId } from "./install-id.server";
import { type LicenceResolver, licenceResolver } from "./resolve.server";
import { licenceRoots } from "./roots";
import {
  EMPTY_STORED,
  readStoredLicence,
  type StoredLicence,
  updateStoredLicence
} from "./store.server";
import type { RootKey, VerifyInput, VerifyOutput } from "./types";
import { verify } from "./verifier.server";

const logger = getLogger("ee", "licence");

const LEASE_KEY = "licence:check-in";
const LEASE_MS = 60_000;
const TIMEOUT_MS = 15_000;
const MAX_BACKOFF_HOURS = 24;

export type CheckInOutcome =
  | { skipped: "edition" | "not-connected" | "held" | "not-due" }
  | { status: "ok" | "revoked" | "failed"; error: string | null };

export type CheckInDeps = {
  edition: () => string;
  resolver: Pick<LicenceResolver, "resolve" | "licenceInUse" | "clearCache">;
  verify: (input: VerifyInput) => Promise<VerifyOutput>;
  readStored: () => Promise<StoredLicence | null>;
  updateStored: (patch: Partial<StoredLicence>) => Promise<unknown>;
  acquireLease: (key: string, ms: number) => Promise<LeaseAcquisition>;
  releaseLease: (key: string, owner: string) => Promise<void>;
  fetch: typeof fetch;
  installId: () => Promise<string>;
  appVersion: () => string;
  roots: () => RootKey[];
  now: () => ZonedDateTime;
};

/** Hours to wait after the n-th failure in a row: 1, 2, 4 … up to 24. */
export const backoffHours = (failures: number) =>
  Math.min(2 ** Math.max(failures - 1, 0), MAX_BACKOFF_HOURS);

/**
 * The daily check-in of a connected licence. It runs from
 * the hourly job, never on a request path, and one process per install
 * talks to the issuer at a time.
 */
export class LicenceCheckIn {
  constructor(private readonly deps: CheckInDeps) {}

  async run({
    seatsUsed,
    companiesCount,
    force = false
  }: {
    seatsUsed: number;
    companiesCount: number;
    force?: boolean;
  }): Promise<CheckInOutcome> {
    if (this.deps.edition() !== Edition.Enterprise)
      return { skipped: "edition" };

    await this.deps.resolver.resolve();
    const inUse = this.deps.resolver.licenceInUse();
    if (inUse?.view.mode !== "connected" || !inUse.checkInUrl) {
      return { skipped: "not-connected" };
    }

    const lease = await this.deps.acquireLease(LEASE_KEY, LEASE_MS);
    if (lease.status === "held") return { skipped: "held" };
    // Redis down: check in anyway. Two processes at once cost one extra renewal.

    try {
      const stored = { ...EMPTY_STORED, ...(await this.deps.readStored()) };
      const at = this.deps.now();
      if (
        !force &&
        stored.nextCheckInAt &&
        parseAbsolute(stored.nextCheckInAt, "UTC").compare(at) > 0
      ) {
        return { skipped: "not-due" };
      }

      const nonce = randomBytes(16).toString("base64url");
      let status: "ok" | "revoked" | "failed" = "failed";
      let error: string | null = null;

      try {
        const res = await this.deps.fetch(inUse.checkInUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            v: 1,
            license: inUse.signedLicense,
            nonce,
            instance_id: await this.deps.installId(),
            seats_used: seatsUsed,
            companies_count: companiesCount,
            app_version: this.deps.appVersion()
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS)
        });
        const body = res.ok
          ? ((await res.json()) as { status?: string; envelope?: string })
          : null;

        if (!body) {
          error = `HTTP ${res.status}`;
        } else if (body.status === "revoked") {
          status = "revoked";
          await this.deps.updateStored({
            revokedLicenseId: inUse.view.license_id,
            sealed: null
          });
        } else if (body.status === "ok" && body.envelope) {
          error = await this.install(body.envelope, inUse, nonce, stored);
          if (!error) status = "ok";
        } else {
          error = body.status ?? "bad response";
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }

      const failures = status === "failed" ? stored.checkInFailures + 1 : 0;
      const waitHours = status === "failed" ? backoffHours(failures) : 24;
      await this.deps.updateStored({
        lastCheckInAt: at.toAbsoluteString(),
        lastCheckInStatus: status,
        lastCheckInError: error,
        checkInFailures: failures,
        seatsUsed,
        nextCheckInAt: at.add({ hours: waitHours }).toAbsoluteString()
      });
      this.deps.resolver.clearCache();
      if (error) logger.warn("licence: check-in failed", { error, failures });
      return { status, error };
    } finally {
      if (lease.status === "acquired") {
        await this.deps
          .releaseLease(LEASE_KEY, lease.owner)
          .catch(() => undefined);
      }
    }
  }

  /** Install-verifies a renewal and stores it. Returns an error code, or null. */
  private async install(
    envelope: string,
    inUse: NonNullable<ReturnType<LicenceResolver["licenceInUse"]>>,
    nonce: string,
    stored: StoredLicence
  ): Promise<string | null> {
    const out = await this.deps.verify({
      sealed: envelope,
      key: inUse.key,
      roots: this.deps.roots(),
      state: stored.state,
      now: this.deps.now().toAbsoluteString(),
      context: "install"
    });
    await this.deps.updateStored({ state: out.state });
    if (!out.ok) return out.error;
    if (out.license.nonce !== nonce) return "ERR_NONCE_MISMATCH";
    if (out.license.license_id !== inUse.view.license_id) {
      return "ERR_LICENSE_MISMATCH";
    }
    await this.deps.updateStored({
      sealed: envelope,
      licenseId: out.license.license_id,
      issuedAt: out.license.issued_at
    });
    return null;
  }
}

export const licenceCheckIn = new LicenceCheckIn({
  edition: () => CarbonEdition,
  resolver: licenceResolver,
  verify,
  readStored: readStoredLicence,
  updateStored: updateStoredLicence,
  acquireLease,
  releaseLease,
  fetch: (...args) => fetch(...args),
  installId: getInstallId,
  appVersion: () => getEnv("CARBON_COMMIT_SHA") || "unknown",
  roots: licenceRoots,
  now: () => now("UTC")
});

export const checkIn = (args: Parameters<LicenceCheckIn["run"]>[0]) =>
  licenceCheckIn.run(args);
