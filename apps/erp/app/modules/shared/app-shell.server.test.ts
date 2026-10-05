// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

// shared.server.ts also holds the sales-order/return PDF and email helpers;
// stub their imports so this test loads only what it exercises.
vi.mock("@carbon/documents/email", () => ({}));
vi.mock("@carbon/jobs", () => ({}));
vi.mock("~/modules/accounting", () => ({}));
vi.mock("~/modules/sales", () => ({}));
vi.mock("~/modules/users/users.server", () => ({}));
vi.mock("~/routes/file+/purchase-return-order+/$id[.]pdf", () => ({}));
vi.mock("~/routes/file+/sales-return-order+/$id[.]pdf", () => ({}));
vi.mock("../documents/documents.service", () => ({}));
vi.mock("~/modules/shared/shared.service", () => ({}));
vi.mock("@carbon/onboarding/server", () => ({}));
vi.mock("~/modules/settings", () => ({
  withLogoUrls: (company: { logoLight: string | null }) => ({
    ...company,
    logoLight: company.logoLight ? `cdn/${company.logoLight}` : null
  })
}));

const { getAppShell } = await import("./shared.server");

type Client = Parameters<typeof getAppShell>[0];
const clientReturning = (result: unknown) => {
  const rpc = vi.fn(async () => result);
  return { client: { rpc } as unknown as Client, rpc };
};

describe("getAppShell", () => {
  it("asks for the caller's company and user, and resolves company logos", async () => {
    const { client, rpc } = clientReturning({
      data: {
        companies: [{ id: "c1", logoLight: "logo.png" }],
        groups: ["g1"],
        user: { id: "u1" }
      },
      error: null
    });
    const shell = await getAppShell(client, "c1", "u1");
    expect(rpc).toHaveBeenCalledWith("get_app_shell", {
      company_id: "c1",
      user_id: "u1"
    });
    expect(shell.error).toBeNull();
    expect(shell.data?.companies).toEqual([
      { id: "c1", logoLight: "cdn/logo.png" }
    ]);
    expect(shell.data?.groups).toEqual(["g1"]);
  });

  it("returns the error and no data when the read fails", async () => {
    const error = { message: "boom" };
    const { client } = clientReturning({ data: null, error });
    expect(await getAppShell(client, "c1", "u1")).toEqual({
      data: null,
      error
    });
  });
});
