// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it, vi } from "vitest";

// The ONE stub, and it is the real external boundary: importing `@carbon/auth`
// validates the whole server env at module load (INNGEST_SIGNING_KEY et al), which
// a unit test has no business booting. Everything below runs real — the actual
// descriptor, the actual mode profiles, the actual zod schema.
vi.mock("@carbon/auth", () => ({ RAMP_CLIENT_ID: "test-client-id" }));
// `@carbon/react`'s barrel reaches components that use Lingui macros, which
// cannot run uncompiled. The descriptor only imports it for the
// setup-instructions JSX, which nothing here renders.
vi.mock("@carbon/react", () => ({
  Copy: () => null,
  Input: () => null,
  InputGroup: () => null,
  InputRightElement: () => null
}));

import { resolveCapabilities } from "../sync/capabilities";
import type { IntegrationSetting } from "../types";
import { Ramp } from "./config";
import { RAMP_MODE_PROFILES } from "./lib/modes";

/**
 * Which settings each install mode offers.
 *
 * The form derives this itself (`IntegrationSetting.availableWhen`), so these
 * assertions are about the DECLARATION: a new GL-account setting added without a
 * gate would be offered to a push-only install, promising posting Carbon must not
 * do; a gate added to an outbound toggle would hide the only controls push-only
 * has. Both are silent in the UI and neither is a type error.
 */

function offeredSettings(mode: keyof typeof RAMP_MODE_PROFILES): string[] {
  const capabilities = resolveCapabilities(
    RAMP_MODE_PROFILES[mode].capabilities
  );
  return (Ramp.settings as IntegrationSetting[])
    .filter((setting) => setting.availableWhen?.(capabilities) !== false)
    .map((setting) => setting.name);
}

describe("Ramp settings by install mode", () => {
  it("offers every setting in provider mode", () => {
    // Provider mode is today's behaviour and must be unchanged by the gate.
    expect(offeredSettings("provider")).toEqual(
      (Ramp.settings as IntegrationSetting[]).map((s) => s.name)
    );
  });

  it("offers only the entity scope and the outbound pushes in push-only mode", () => {
    expect(offeredSettings("push-only")).toEqual([
      "entityId",
      "pushPurchaseOrders",
      "pushInvoices"
    ]);
  });

  it("hides the whole Accounts group in push-only mode", () => {
    // The form builds its group list from the surviving settings, so "no setting
    // of this group survives" is exactly what makes the group header disappear.
    const surviving = new Set(offeredSettings("push-only"));
    const accountSettings = (Ramp.settings as IntegrationSetting[]).filter(
      (s) => s.group === "Accounts"
    );

    expect(accountSettings.length).toBeGreaterThan(0);
    expect(accountSettings.filter((s) => surviving.has(s.name))).toEqual([]);
  });

  it("names a ledger holder only when Carbon does not hold the seat", () => {
    // Provider mode never refreshes the ledger-holder snapshot, so it must not show it.
    const stored = { accountingConnectionProvider: "Rillet" };

    expect(
      Ramp.resolveInstallMode?.({ ...stored, syncMode: "provider" })
    ).toEqual({ id: "provider", detail: undefined });

    // An install with no stored mode is a provider install.
    expect(Ramp.resolveInstallMode?.(stored)).toEqual({
      id: "provider",
      detail: undefined
    });

    expect(
      Ramp.resolveInstallMode?.({ ...stored, syncMode: "push-only" })
    ).toEqual({ id: "push-only", detail: "Rillet" });
  });

  it("keeps the card liability account optional in the schema", () => {
    // It is required for a provider install, but push-only never renders the
    // field — a `.min(1)` here made the entire settings form unsaveable in that
    // mode. Requiredness is enforced in `convergeRamp` / `rampHealthcheck`, both
    // behind `rampOwnsCodingSurface`.
    const parsed = Ramp.schema.safeParse({ pushInvoices: "true" });
    expect(parsed.success).toBe(true);
  });
});
