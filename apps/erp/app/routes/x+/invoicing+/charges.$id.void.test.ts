// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

/**
 * The boundaries this action has are the post-charge operation and the session cookie;
 * everything between them is the action's own control flow, which is what is
 * under test. `flash` is stubbed to put the user-facing message on a header so a
 * thrown redirect can be read.
 */
const postCharge = vi.hoisted(() => vi.fn());

vi.mock("@carbon/auth", () => ({
  assertIsPost: () => undefined,
  error: (_error: unknown, message: string) => ({ success: false, message }),
  success: (message: string) => ({ success: true, message })
}));
vi.mock("@carbon/auth/auth.server", () => ({
  requirePermissions: () =>
    Promise.resolve({ companyId: "company-1", userId: "user-1" })
}));
vi.mock("@carbon/server-functions", () => {
  const bind = (actor: string) => (fields: object) => ({
    invoke: (_name: string, input: unknown) =>
      postCharge({ ...fields, actor }, input)
  });
  return { serverFns: { system: bind("system"), as: bind("caller") } };
});
vi.mock("~/services/database.server", () => ({
  getDatabaseClient: () => ({})
}));
// `~/utils/path` resolves ERP/MES URLs from `@carbon/env` at module load, which
// a unit test has no business booting.
vi.mock("~/utils/path", () => ({
  path: { to: { charge: (id: string) => `/x/invoicing/charges/${id}` } }
}));
vi.mock("@carbon/auth/session.server", () => ({
  flash: (_request: Request, result: { message: string }) =>
    Promise.resolve({ headers: { "x-flash": result.message } })
}));

import { action } from "./charges.$id.void";

function run() {
  return action({
    request: new Request("http://localhost/x/invoicing/charges/chg_1/void", {
      method: "post"
    }),
    params: { id: "chg_1" }
  } as never).then(
    () => {
      throw new Error("the action should always throw a redirect");
    },
    (thrown: unknown) => thrown
  );
}

describe("voiding a charge", () => {
  it("surfaces the operation's own refusal instead of a generic string", async () => {
    // The refusal is the whole point of the round-trip. Catching the redirect
    // that carries it and replacing it with "Failed to void charge" left the
    // user staring at a Posted charge with no idea why it stayed posted.
    postCharge.mockResolvedValue({
      data: null,
      error: { message: "Charge is already voided" }
    });

    const thrown = await run();
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).headers.get("x-flash")).toBe(
      "Charge is already voided"
    );
  });

  it("falls back to a generic string when the failure has no user-facing message", async () => {
    // A data-layer failure arrives with an empty message by design.
    postCharge.mockResolvedValue({ data: null, error: { message: "" } });

    expect(((await run()) as Response).headers.get("x-flash")).toBe(
      "Failed to void charge"
    );
  });

  it("still reports a genuine throw generically", async () => {
    // A real exception is NOT a Response, so the generic handler must still own
    // it — the rethrow guard must not swallow the error path it replaced.
    postCharge.mockRejectedValue(new Error("socket hang up"));

    expect(((await run()) as Response).headers.get("x-flash")).toBe(
      "Failed to void charge"
    );
  });

  it("reports success when the void lands", async () => {
    postCharge.mockResolvedValue({ data: { success: true }, error: null });

    expect(((await run()) as Response).headers.get("x-flash")).toBe(
      "Charge voided"
    );
  });
});
