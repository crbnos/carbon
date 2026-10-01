// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

const requirePermissions = vi.hoisted(() => vi.fn());
const getIntegrationsWithHealth = vi.hoisted(() => vi.fn());

vi.mock("@carbon/auth", () => ({ error: vi.fn() }));
vi.mock("@carbon/auth/auth.server", () => ({ requirePermissions }));
vi.mock("@carbon/auth/session.server", () => ({ flash: vi.fn() }));
vi.mock("@carbon/ee", () => ({
  integrations: [],
  quickInstallConnectors: [],
  // The loader derives which role slots are taken so the cards can disable a
  // conflicting Install. No integrations in this fixture, so no role is held.
  getIntegrationIdsByRole: () => []
}));
vi.mock("@carbon/react", () => ({ toast: { error: vi.fn() } }));
vi.mock("@lingui/react/macro", () => ({ useLingui: vi.fn() }));
vi.mock("~/modules/settings", () => ({ IntegrationsList: vi.fn() }));
vi.mock("~/modules/settings/integration-errors", () => ({
  getIntegrationError: vi.fn()
}));
vi.mock("~/modules/settings/settings.server", () => ({
  getIntegrationsWithHealth
}));
vi.mock("~/utils/path", () => ({
  path: {
    to: { integrations: "/x/settings/integrations", settings: "/x/settings" }
  }
}));

import { loader } from "./integrations";

/**
 * This loader used to issue Ramp's signed OAuth state. It no longer does, and the
 * assertion below is the inverse of the one it replaced.
 *
 * The state moved to `api+/integrations.$id.connect`, because only that route
 * knows the chosen install MODE — and the mode has to be inside the signed cookie
 * for the callback to trust it. A state issued here could not carry one, so an
 * install started from a loader-issued state would land with no mode and silently
 * resolve to `provider`: the customer picks "another system posts my ledger" and
 * Carbon records the opposite.
 *
 * Reintroducing a server-issued state here is therefore a real regression, which
 * is what this pins. The signed-state behaviour itself is covered by
 * `api+/integrations.$id.connect.test.ts`.
 */
describe("integrations loader", () => {
  it("issues no OAuth state of its own", async () => {
    requirePermissions.mockResolvedValue({
      client: {},
      userId: "user-1",
      companyId: "company-1"
    });
    getIntegrationsWithHealth.mockResolvedValue({ data: [], error: null });

    const result = (await loader({
      request: new Request("https://erp.example.com/x/settings/integrations"),
      params: {}
    } as never)) as {
      data?: { oauthStates?: Record<string, string>; state?: string };
      init?: { headers?: HeadersInit };
    };

    expect(result.data?.oauthStates).toBeUndefined();
    // Whatever the wrapper shape, the point is that nothing sets a state cookie.
    expect(new Headers(result.init?.headers).get("Set-Cookie")).toBeNull();
  });

  it("supplies no correlation value either", async () => {
    // EVERY OAuth install now starts at the connect route, which issues a signed,
    // browser-bound, single-use state. A value handed out here would be unsigned
    // and unbound — reintroducing one is a downgrade, not a convenience.
    requirePermissions.mockResolvedValue({
      client: {},
      userId: "user-1",
      companyId: "company-1"
    });
    getIntegrationsWithHealth.mockResolvedValue({ data: [], error: null });

    const result = (await loader({
      request: new Request("https://erp.example.com/x/settings/integrations"),
      params: {}
    } as never)) as { data?: { state?: string } };

    expect(result.data?.state).toBeUndefined();
  });
});
