// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import {
  AxiosError,
  AxiosHeaders,
  type AxiosRequestConfig,
  type AxiosResponse
} from "axios";
import { describe, expect, it, vi } from "vitest";

vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => ({})
}));
vi.mock("../../integrations/secrets", () => ({
  resolveIntegrationSecrets: vi.fn()
}));
vi.mock("./service", () => ({
  getMountIntegration: vi.fn(),
  MOUNT_INTEGRATION_ID: "mount"
}));

const { MountClient } = await import("./client");

const COMPANY_ID = "company_1";

function forbidden() {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError(
    "Request failed with status code 403",
    "ERR_BAD_REQUEST",
    config,
    {},
    {
      status: 403,
      statusText: "",
      data: "",
      headers: {},
      config
    } as AxiosResponse
  );
}

/**
 * A Mount that issues t1, t2, … and refuses t1 once `refuseFirstToken` is
 * set. Each refusal waits until the test releases it, so the test decides
 * the order in which concurrent requests learn of their 403.
 */
function createMount() {
  const client = new MountClient();
  vi.spyOn(client, "getSettings").mockResolvedValue({
    clientId: "client",
    clientSecret: "secret",
    tenant: "tenant"
  });

  let issued = 0;
  const pendingRefusals: Array<() => void> = [];
  const state = { refuseFirstToken: false };

  client.instance.request = vi.fn(async (config: AxiosRequestConfig) => {
    if (config.url === "/auth/v2/token") {
      issued += 1;
      return {
        data: { accessToken: `t${issued}`, expiresAt: "2999-01-01T00:00:00Z" }
      };
    }
    const token = String(config.headers?.Authorization).replace("Bearer ", "");
    if (token === "t1" && state.refuseFirstToken) {
      await new Promise<void>((release) => pendingRefusals.push(release));
      throw forbidden();
    }
    return { data: [] };
  }) as typeof client.instance.request;

  return {
    client,
    state,
    issued: () => issued,
    releaseNextRefusal: () => pendingRefusals.shift()?.(),
    refusalsWaiting: () => pendingRefusals.length
  };
}

describe("MountClient 403 handling", () => {
  it("re-exchanges a stale token once, even when a parallel request already did", async () => {
    const mount = createMount();
    // A token issued before the client's Member ID was set in Mount.
    await mount.client.listCompanyTypes(COMPANY_ID);
    mount.state.refuseFirstToken = true;

    const first = mount.client.listCompanyTypes(COMPANY_ID);
    const second = mount.client.listCompanyTypes(COMPANY_ID);
    await vi.waitFor(() => expect(mount.refusalsWaiting()).toBe(2));

    // The first 403 replaces t1 with t2, a token whose 403 would be final.
    mount.releaseNextRefusal();
    await expect(first).resolves.toEqual([]);

    // The second request sent t1 too; its 403 is stale, not final.
    mount.releaseNextRefusal();
    await expect(second).resolves.toEqual([]);
    expect(mount.issued()).toBe(2);
  });
});
