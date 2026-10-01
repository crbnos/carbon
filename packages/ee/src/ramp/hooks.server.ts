// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Copyright (C) Carbon Manufacturing Systems Corporation.
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { getAppUrl } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { SpendProviderID } from "../accounting/core/models";
import { ensureProviderSubscriptions } from "../accounting/core/subscriptions";
import { resolveCapabilities } from "../sync/capabilities";
import { applyPartyContactRequirements } from "../sync/party-contact";
import {
  extractConnections,
  isCarbonConnection,
  isConnectionLinked,
  linkedConnections,
  resolveConnectedProviderName
} from "./lib/connection-status";
import { rampOwnsCodingSurface, resolveRampModeProfile } from "./lib/modes";
import {
  clearRampConnectionMetadata,
  ensureRampConnection,
  ensureRampWebhook,
  getRampIntegration,
  pushChartOfAccounts,
  pushCostCenters,
  pushProjects
} from "./lib/service";
import { patchRampAccountingConnectionProvider } from "./lib/state";

/**
 * Ramp integration lifecycle hooks (server-only). Registered in
 * `packages/ee/src/hooks.server.ts` and exported via `@carbon/ee/ramp/hooks.server`.
 * Cloned from the Rillet hook shape.
 */

/**
 * Converge the company's Ramp integration: validate credentials, ensure the
 * accounting connection, push CoA + cost centers, and register the webhook
 * (idempotent — `ensureRampWebhook` skips when a webhookId is already set).
 */
async function convergeRamp(
  companyId: string,
  opts: { syncReason: "install" | "settings-update" }
): Promise<void> {
  const serviceRole = getCarbonServiceRole();
  const integration = await getRampIntegration(serviceRole, companyId);
  if (!integration) return;

  const { client, metadata } = integration;

  // Validate credentials up front so a bad clientId/secret fails the install
  // with a clear message rather than deep inside a push.
  try {
    await client.getBusiness();
  } catch (err) {
    throw new Error(
      `Could not reach the Ramp API with the provided credentials — check the client id and secret. ${
        (err as Error).message
      }`
    );
  }

  const ownsCodingSurface = rampOwnsCodingSurface(metadata);

  // Connecting a platform that cannot create a vendor without a reachable
  // contact AND an identifiable location is what makes both mandatory, so
  // connecting it turns the requirement on. Driven by the mode profile's
  // declared capabilities, NOT by this being the Ramp hook — a second spend
  // provider declares the same capability and gets the same behaviour with no
  // edit here.
  //
  // Best-effort: a settings write must never fail an otherwise-good connection.
  try {
    const enabled = await applyPartyContactRequirements(
      serviceRole,
      companyId,
      resolveCapabilities(resolveRampModeProfile(metadata).capabilities)
    );
    if (enabled.length > 0) {
      console.log(
        `[ramp] enabled ${enabled.join(", ")} for company ${companyId} — Ramp cannot create a vendor without a contact email and a country`
      );
    }
  } catch (err) {
    console.error(
      `[ramp] could not enable party-contact requirements for company ${companyId}:`,
      (err as Error).message
    );
  }

  // Only the seat-holder may create the accounting connection. In push-only
  // another system holds it, and claiming it is precisely what this mode exists
  // to avoid.
  if (ownsCodingSurface) {
    await ensureRampConnection(serviceRole, companyId);
  }

  // Refresh which system Ramp reports as holding the accounting seat.
  //
  // Only meaningful when Carbon is NOT the seat-holder — in provider mode Carbon
  // holds it and the field is noise. The value is otherwise written once at
  // connect and never revisited, so a peer that later disconnected left the
  // details drawer naming it indefinitely.
  //
  // A FAILED read leaves the previous value untouched: "Carbon could not ask" is
  // not "nobody is connected", and erasing on error would flap the drawer on any
  // transient Ramp outage. Confirmed 2026-09-26 that a push-only token (no
  // `accounting:write`) may call this endpoint, so a refusal here is unexpected
  // rather than routine.
  if (!ownsCodingSurface) {
    try {
      await patchRampAccountingConnectionProvider(
        serviceRole,
        companyId,
        resolveConnectedProviderName(await client.getAccountingConnections())
      );
    } catch (err) {
      console.warn(
        `[ramp] could not refresh the accounting connection owner for company ${companyId}; leaving the stored value`,
        err
      );
    }
  }

  // Converge Ramp's SYNC event subscriptions, exactly as the accounting
  // providers' hooks do. Purchase orders and open payables push through the
  // shared event engine, so without these rows nothing is ever enqueued.
  await ensureProviderSubscriptions(
    serviceRole,
    companyId,
    SpendProviderID.RAMP
  );
  // The webhook is latency, not correctness — the hourly `ramp-sweep` is the
  // correctness guarantee. Ramp can't reach a non-public dev host
  // (erp.<branch>.dev), so webhook registration will fail locally; that must not
  // block the connect. Log and continue.
  try {
    await ensureRampWebhook(serviceRole, companyId, getAppUrl());
  } catch (err) {
    console.warn(
      `[ramp] webhook registration failed for company ${companyId}; continuing install (hourly sweep covers correctness)`,
      err
    );
  }

  // OAuth creates the credential-bearing integration row before the user maps
  // the card liability account that every card journal credits. Establish
  // connectivity, but do not push master data or launch finance until that one
  // required account exists. statementBankAccountId is NOT required here — it is
  // only the offset for statement payments and transfers, and each of those
  // families self-gates on it (skipping when unset). Coupling it here blocked
  // card-charge sync on an account card charges never touch.
  //
  // Scoped to the seat-holder: in push-only mode this account is not merely
  // unset, it is irrelevant — Carbon posts no card journal, and the settings form
  // does not even offer the field. Returning here would have skipped the sync
  // enqueue below, so push-only would have pushed nothing until the next hourly
  // sweep.
  if (ownsCodingSurface && !metadata.cardLiabilityAccountId) {
    return;
  }

  if (metadata.entityId) {
    let response: unknown;
    try {
      response = await client.getEntities();
    } catch (error) {
      throw new Error(`Could not validate Ramp entity ${metadata.entityId}`, {
        cause: error
      });
    }

    if (!extractEntityIds(response).has(metadata.entityId)) {
      throw new Error(
        `Ramp entity ${metadata.entityId} is not available to this connection`
      );
    }
  }

  // Coding masters belong to whoever holds the connection: every one of these is
  // an `accounting:write` call, and in push-only the options Ramp offers are the
  // OTHER system's to publish. One gate covers all three — nothing can push a
  // coding master without the connection anyway.
  //
  // The sync still launches below: push-only has plenty to do (purchase orders,
  // receipts, provisional bills, and pulling bill payments back).
  if (ownsCodingSurface) {
    await pushChartOfAccounts(serviceRole, companyId);
    // Converge the cost-center ("project") field + its options. It re-runs on
    // every ramp-sync too, so a Ramp-side rejection here must not abort a valid
    // connection — log and continue so the hourly sweep can retry it.
    try {
      await pushCostCenters(serviceRole, companyId);
    } catch (err) {
      console.warn(
        `[ramp] cost-center push failed for company ${companyId}; continuing convergence`,
        err
      );
    }
    // Converge the Project field + its options — a second custom field, kept
    // independent of the cost-center one. Same fail-soft stance: the sweep retries.
    try {
      await pushProjects(serviceRole, companyId);
    } catch (err) {
      console.warn(
        `[ramp] project push failed for company ${companyId}; continuing convergence`,
        err
      );
    }
  }

  // `@carbon/jobs` is deliberately NOT an `@carbon/ee` dependency (jobs -> ee,
  // never the reverse), so the `ramp-sync` task — registered in
  // packages/jobs/src/inngest/index.ts + packages/lib/src/trigger.ts — is
  // reached via a lazy runtime import resolved through the app that owns both
  // packages. The non-literal specifier keeps TS from resolving/type-checking a
  // module ee cannot see.
  // A failure to enqueue the initial sync must not fail the connect — the
  // hourly `ramp-sweep` fires `ramp-sync` for every active company regardless.
  try {
    const jobsModule = "@carbon/jobs";
    const jobs = (await import(/* @vite-ignore */ jobsModule)) as {
      trigger: (
        task: string,
        payload: { companyId: string; reason: string }
      ) => Promise<unknown>;
    };
    await jobs.trigger("ramp-sync", {
      companyId,
      reason: opts.syncReason
    });
  } catch (err) {
    console.warn(
      `[ramp] initial sync enqueue failed for company ${companyId}; the hourly sweep will cover it`,
      err
    );
  }
}

export async function rampOnInstall(companyId: string): Promise<void> {
  await convergeRamp(companyId, { syncReason: "install" });
}

/**
 * Settings-save on an already-installed integration: re-converge and launch a
 * sync only after the required account and optional entity settings validate.
 */
export async function rampOnUpdate(companyId: string): Promise<void> {
  await convergeRamp(companyId, { syncReason: "settings-update" });
}

export async function rampOnUninstall(companyId: string): Promise<void> {
  const serviceRole = getCarbonServiceRole();
  // `includeInactive`: the uninstall route deactivates the row BEFORE calling
  // this hook, so the default read returns null here and every remote teardown
  // below silently never ran.
  const integration = await getRampIntegration(serviceRole, companyId, {
    includeInactive: true
  });

  if (integration) {
    const { client, metadata } = integration;

    if (metadata.webhookId) {
      try {
        await client.deleteWebhook(metadata.webhookId);
      } catch (err) {
        // Tolerate a missing webhook (already deleted).
        console.error(
          `[ramp] failed to delete webhook on uninstall (company ${companyId}): ${
            (err as Error).message
          }`
        );
      }
    }

    try {
      // Only when Carbon owns it — and "owns" means the connection at Ramp is
      // actually Carbon's, NOT merely that this install is in provider mode.
      //
      // The mode alone was not enough, and the gap was destructive rather than
      // theoretical: a provider-mode install that had ADOPTED another system's
      // connection (see `ensureRampConnection`) deleted that system's connection
      // on uninstall. It happened here on 2026-09-26 and unlinked a live peer.
      // `ensureRampConnection` now refuses to adopt, but an install created
      // before that fix still carries the adopted id, so the delete re-checks
      // whose connection it is against Ramp rather than trusting metadata.
      //
      // Note this does NOT revoke Carbon's OAuth grant: Ramp exposes no
      // revocation endpoint (confirmed 2026-09-25 against `llms-api.txt` and the
      // OpenAPI spec). A reinstall may therefore still hold `accounting:write`.
      // The accepted position is that Carbon never USES it outside provider mode
      // — see `rampOwnsCodingSurface`, which gates every write-scope call.
      if (rampOwnsCodingSurface(metadata)) {
        const live = linkedConnections(await client.getAccountingConnections());
        // Nothing linked: nothing to tear down. A connection that is Carbon's is
        // deleted; one belonging to anyone else is left alone and said so.
        const foreign = live.find((c) => !isCarbonConnection(c));
        if (live.some(isCarbonConnection)) {
          await client.deleteAccountingConnection();
        } else if (foreign) {
          console.warn(
            `[ramp] leaving the accounting connection in place for company ${companyId}: it is held by ${
              foreign.remote_provider_name ?? "another system"
            }, not Carbon`
          );
        }
      }
    } catch (err) {
      // Tolerate — the connection may already be gone.
      console.error(
        `[ramp] failed to delete accounting connection on uninstall (company ${companyId}): ${
          (err as Error).message
        }`
      );
    }
  }

  // Clear the stored `webhookId`/`connectionId` so a later reinstall re-creates
  // both at Ramp instead of trusting ids that were torn down here. Runs even
  // when the integration row is already deactivated (the read above returns null
  // then, since it gates on `active`) — `clearRampConnectionMetadata` reads the
  // row directly, so a deactivated-but-present row is still cleared.
  try {
    await clearRampConnectionMetadata(serviceRole, companyId);
  } catch (err) {
    console.error(
      `[ramp] failed to clear stored webhook/connection metadata on uninstall (company ${companyId}): ${
        (err as Error).message
      }`
    );
  }
}

/** Extract entity ids from Ramp's `{ data }`, `{ entities }`, or bare-array shape. */
function extractEntityIds(response: unknown): Set<string> {
  let rows: unknown[] = [];
  if (Array.isArray(response)) {
    rows = response;
  } else if (response && typeof response === "object") {
    const value = response as { data?: unknown; entities?: unknown };
    if (Array.isArray(value.data)) rows = value.data;
    else if (Array.isArray(value.entities)) rows = value.entities;
  }

  return new Set(
    rows.flatMap((row) =>
      row &&
      typeof row === "object" &&
      typeof (row as { id?: unknown }).id === "string"
        ? [(row as { id: string }).id]
        : []
    )
  );
}

export async function rampHealthcheck(
  companyId: string,
  _metadata: Record<string, unknown>
): Promise<boolean> {
  // Build the client via getRampIntegration so it carries the OAuth app creds
  // and token-refresh. The health framework's passed metadata builds a client
  // with no `oauthApp`, which cannot refresh an expired oauth2 access token and
  // would report a healthy connection as unhealthy after ~1h.
  const integration = await getRampIntegration(
    getCarbonServiceRole(),
    companyId
  );
  if (!integration) return false;

  // A connected Ramp with no card liability account is not functional:
  // convergeRamp returns early (no chart-of-accounts push, no sync) and the
  // charge sync gate skips every family without it. Report it as
  // unhealthy rather than showing a green badge over a sync that silently does
  // nothing — the required-field gap was invisible in the UI otherwise.
  // statementBankAccountId is intentionally NOT checked: it is optional (only
  // statement-payment/transfer sync needs it), so its absence is a healthy
  // "that family is off", not a broken connection.
  // Required only where card charges actually post. A push-only install never
  // pulls a card charge, so demanding the account it credits would report an
  // integration unhealthy for a family it does not run.
  const ownsCodingSurface = rampOwnsCodingSurface(integration.metadata);
  if (ownsCodingSurface && !integration.metadata.cardLiabilityAccountId) {
    return false;
  }

  try {
    await integration.client.getBusiness();
    const connections = extractConnections(
      await integration.client.getAccountingConnections()
    );
    const linked = connections.filter((connection) =>
      isConnectionLinked(connection.status)
    );

    // What "healthy" means differs by mode, because what Carbon OWNS differs.
    //
    // Provider mode: Carbon holds the seat, so its own connection must be live.
    // Checking `linked.length > 0` was too weak — it passed while another
    // system held the seat and Carbon held nothing.
    //
    // Push-only: Carbon owns no connection, by design. Requiring one reported a
    // perfectly functional install as broken whenever the customer had not yet
    // connected their accounting system — a legitimate, ordinary state during
    // onboarding, and one Carbon cannot act on. Carbon's own side is reachable
    // and it can still push purchase orders and bills, so that is healthy.
    //
    // The cost is deliberate: an install whose peer never appears hands Ramp
    // bills nobody will post, and this no longer surfaces that. The badge is a
    // boolean with no room to say why, and "broken" is the more misleading of
    // the two answers. See `.ai/runs/2026-09-26-ramp-push-only-verification.md`.
    return ownsCodingSurface ? linked.some(isCarbonConnection) : true;
  } catch {
    return false;
  }
}
