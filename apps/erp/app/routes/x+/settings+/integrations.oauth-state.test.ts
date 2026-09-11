import { describe, expect, it, vi } from "vitest";

const requirePermissions = vi.hoisted(() => vi.fn());
const getIntegrationsWithHealth = vi.hoisted(() => vi.fn());

vi.mock("@carbon/auth", () => ({ error: vi.fn() }));
vi.mock("@carbon/auth/auth.server", () => ({ requirePermissions }));
vi.mock("@carbon/auth/session.server", () => ({ flash: vi.fn() }));
vi.mock("@carbon/ee", () => ({
  integrations: [],
  quickInstallConnectors: []
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

describe("integrations OAuth state loader", () => {
  it("issues a server-bound Ramp state and sends its signed cookie", async () => {
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
      data?: { oauthStates?: Record<string, string> };
      init?: { headers?: HeadersInit };
    };

    expect(result.data?.oauthStates?.ramp).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(new Headers(result.init?.headers).get("Set-Cookie")).toContain(
      "carbon-oauth-state="
    );
  });
});
