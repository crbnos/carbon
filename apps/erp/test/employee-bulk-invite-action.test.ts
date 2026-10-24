// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { CarbonError, createServiceContext } from "@carbon/api/service-fn.server";
import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: { CONTROLLED_ENVIRONMENT: false },
  requirePermissions: vi.fn(),
  companyHasFeature: vi.fn(),
  request: vi.fn(),
  createEmployeeAccount: vi.fn(),
  refuseEmailOutsideSso: vi.fn(),
  inviteSender: vi.fn(),
  sendInviteEmail: vi.fn(),
  from: vi.fn(),
  adminSelect: vi.fn(),
  adminEq: vi.fn(),
  adminMaybeSingle: vi.fn()
}));

vi.mock("@carbon/auth", () => ({
  get CONTROLLED_ENVIRONMENT() {
    return mocks.auth.CONTROLLED_ENVIRONMENT;
  },
  CarbonEdition: "test",
  success: (message: string) => ({ message })
}));
vi.mock("@carbon/auth/auth.server", () => ({
  requirePermissions: mocks.requirePermissions
}));
vi.mock("@carbon/auth/session.server", () => ({ flash: async () => ({}) }));
vi.mock("@carbon/ee/plan.server", () => ({
  companyHasFeature: mocks.companyHasFeature
}));
vi.mock("@carbon/form", () => ({
  validator: () => ({ request: mocks.request }),
  validationError: (error: unknown) => ({ error })
}));
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  })
}));
vi.mock("@carbon/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@carbon/utils")>()),
  datetime: { timestamp: () => "2026-09-27T00:00:00Z" }
}));
vi.mock("~/modules/users/ui", () => ({
  BulkInviteEmployeesModal: () => null
}));
vi.mock("~/modules/users/users.service", () => ({
  createEmployeeAccount: mocks.createEmployeeAccount,
  refuseEmailOutsideSso: mocks.refuseEmailOutsideSso,
  inviteSender: mocks.inviteSender,
  sendInviteEmail: mocks.sendInviteEmail,
  originOf: () => ({ ip: "127.0.0.1", city: "Unknown" })
}));
vi.mock("~/utils/path", () => ({
  path: {
    to: {
      bulkInviteEmployees: "/x/users/employees/bulk-invite",
      employeeAccounts: "/x/users/employees"
    }
  }
}));

import { registerCarbon } from "@carbon/api/carbon.server";
import { bulkInviteEmployees } from "../app/modules/users/users.server";
import { action, loader } from "../app/routes/x+/users+/employees.bulk-invite";
import { loader as redirectLoader } from "../app/routes/x+/users+/employees.new";

const makeCtx = () =>
  createServiceContext({
    actor: {
      type: "user",
      userId: "inviter-a",
      permissions: {
        users: {
          view: ["company-a"],
          create: ["company-a"],
          update: ["company-a"],
          delete: ["company-a"]
        }
      }
    },
    company: { id: "company-a", groupId: "group-a" },
    caller: { from: mocks.from } as unknown as SupabaseClient<Database>,
    system: () => ({}) as unknown as SupabaseClient<Database>,
    pg: () => ({}) as unknown as Kysely<KyselyDatabase>,
    kv: () => ({}) as never
  });

registerCarbon({
  router: { users: { bulkInviteEmployees } } as never,
  context: () => makeCtx()
});

const employee = (rowId: string, employeeType: string) => ({
  rowId,
  email: `${rowId}@example.com`,
  firstName: "First",
  lastName: "Last",
  employeeType,
  locationId: "location-a",
  usPersonAttestation: false
});
const requestArgs = () => ({
  request: new Request("http://localhost/x/users/employees/bulk-invite", {
    method: "POST",
    body: new FormData()
  }),
  params: {},
  context: {},
  url: new URL("http://localhost/x/users/employees/bulk-invite"),
  pattern: "/x/users/employees/bulk-invite"
});

const inviteResults = (result: Awaited<ReturnType<typeof action>>) => {
  if (!result || typeof result !== "object" || !("results" in result)) {
    throw new Error("Expected invitation results");
  }
  return result.results;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.CONTROLLED_ENVIRONMENT = false;
  const adminQuery = {
    select: mocks.adminSelect,
    eq: mocks.adminEq,
    maybeSingle: mocks.adminMaybeSingle
  };
  mocks.adminSelect.mockReturnValue(adminQuery);
  mocks.adminEq.mockReturnValue(adminQuery);
  mocks.adminMaybeSingle.mockResolvedValue({ data: { id: "admin-a" } });
  mocks.from.mockImplementation((table: string) => {
    if (table === "employeeType") return adminQuery;
    throw new Error(`Unexpected table ${table}`);
  });
  mocks.requirePermissions.mockResolvedValue({
    client: { from: mocks.from },
    companyId: "company-a",
    companyGroupId: "group-a",
    userId: "inviter-a",
    caller: "user",
    permissions: {}
  });
  mocks.companyHasFeature.mockResolvedValue(false);
  mocks.request.mockResolvedValue({
    data: {
      employees: [
        employee("row-a", "submitted-a"),
        employee("row-b", "submitted-b")
      ]
    },
    params: {},
    formData: new FormData()
  });
  mocks.createEmployeeAccount.mockResolvedValue({
    success: true,
    code: "invite-code",
    userId: "user-a"
  });
  mocks.refuseEmailOutsideSso.mockResolvedValue(null);
  mocks.inviteSender.mockResolvedValue({
    companyName: "Company A",
    invitedBy: { email: "inviter@example.com", fullName: "Inviter" }
  });
  mocks.sendInviteEmail.mockResolvedValue({
    data: { id: "email-a" },
    error: null
  });
});

describe("bulk invite upstream role policy", () => {
  it("stops before all downstream operations when create permission is denied", async () => {
    mocks.requirePermissions.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(action(requestArgs())).rejects.toThrow("Forbidden");
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.companyHasFeature).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.createEmployeeAccount).not.toHaveBeenCalled();
    expect(mocks.sendInviteEmail).not.toHaveBeenCalled();
  });

  it("uses the company Admin type for all gated rows and looks it up once", async () => {
    await expect(action(requestArgs())).rejects.toBeInstanceOf(Response);
    expect(mocks.requirePermissions).toHaveBeenCalledWith(expect.any(Request), {
      create: "users"
    });
    expect(mocks.companyHasFeature).toHaveBeenCalledWith(
      expect.any(Object),
      "company-a",
      { feature: "PERMISSIONS" }
    );
    expect(mocks.companyHasFeature).toHaveBeenCalledOnce();
    expect(mocks.adminMaybeSingle).toHaveBeenCalledOnce();
    expect(mocks.adminEq.mock.calls).toEqual([
      ["companyId", "company-a"],
      ["systemType", "Admin"]
    ]);
    expect(
      mocks.createEmployeeAccount.mock.calls.map(([, , args]) => args.employeeType)
    ).toEqual(["admin-a", "admin-a"]);
    for (const [, , args] of mocks.createEmployeeAccount.mock.calls) {
      expect(args).toMatchObject({
        companyId: "company-a",
        createdBy: "inviter-a"
      });
    }
  });

  it("preserves the selected type for each ungated row", async () => {
    mocks.companyHasFeature.mockResolvedValue(true);
    await expect(action(requestArgs())).rejects.toBeInstanceOf(Response);
    expect(mocks.adminMaybeSingle).not.toHaveBeenCalled();
    expect(
      mocks.createEmployeeAccount.mock.calls.map(([, , args]) => args.employeeType)
    ).toEqual(["submitted-a", "submitted-b"]);
  });

  it("preserves upstream fallback when no seeded Admin is found", async () => {
    mocks.adminMaybeSingle.mockResolvedValue({ data: null });
    await expect(action(requestArgs())).rejects.toBeInstanceOf(Response);
    expect(
      mocks.createEmployeeAccount.mock.calls.map(([, , args]) => args.employeeType)
    ).toEqual(["submitted-a", "submitted-b"]);
  });

  it("does not invite or email rows lacking controlled-environment attestation", async () => {
    mocks.auth.CONTROLLED_ENVIRONMENT = true;
    const result = await action(requestArgs());
    expect(inviteResults(result).map((row) => row.success)).toEqual([
      false,
      false
    ]);
    expect(mocks.createEmployeeAccount).not.toHaveBeenCalled();
    expect(mocks.sendInviteEmail).not.toHaveBeenCalled();
  });

  it("preserves SSO rejection and stable partial-failure row IDs", async () => {
    mocks.refuseEmailOutsideSso
      .mockResolvedValueOnce(new CarbonError("rule", "Outside SSO domain"))
      .mockResolvedValueOnce(null);
    const result = await action(requestArgs());
    expect(inviteResults(result)).toMatchObject([
      { rowId: "row-a", success: false, message: "Outside SSO domain" },
      { rowId: "row-b", success: true }
    ]);
    expect(mocks.createEmployeeAccount).toHaveBeenCalledOnce();
    expect(mocks.createEmployeeAccount.mock.calls[0][2].email).toBe(
      "row-b@example.com"
    );
    expect(mocks.sendInviteEmail).toHaveBeenCalledOnce();
  });

  it("keeps failed deliveries as failed invitation rows", async () => {
    mocks.sendInviteEmail.mockResolvedValue({
      data: null,
      error: new Error("SMTP refused")
    });
    const result = await action(requestArgs());
    expect(inviteResults(result)).toMatchObject([
      {
        rowId: "row-a",
        success: false,
        message: "Created, but invite email failed to send"
      },
      {
        rowId: "row-b",
        success: false,
        message: "Created, but invite email failed to send"
      }
    ]);
  });

  it("stops before role lookups and writes when validation fails", async () => {
    mocks.request.mockResolvedValue({
      invalid: { error: { fieldErrors: { employees: "Invalid" } } }
    });
    expect(await action(requestArgs())).toHaveProperty("error");
    expect(mocks.companyHasFeature).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.createEmployeeAccount).not.toHaveBeenCalled();
  });

  it("continues subsequent rows after email transport throws", async () => {
    mocks.sendInviteEmail.mockRejectedValueOnce(new Error("SMTP disconnected"));
    const result = await action(requestArgs());
    expect(inviteResults(result)).toMatchObject([
      {
        rowId: "row-a",
        success: false,
        message: "Created, but invite email failed to send"
      },
      { rowId: "row-b", success: true }
    ]);
    expect(mocks.createEmployeeAccount).toHaveBeenCalledTimes(2);
    expect(mocks.sendInviteEmail).toHaveBeenCalledTimes(2);
  });

  it("checks create permission for the bulk loader", async () => {
    await loader(requestArgs());
    expect(mocks.requirePermissions).toHaveBeenCalledWith(expect.any(Request), {
      create: "users"
    });
  });

  it("preserves the permission-checked legacy redirect and query string", async () => {
    const args = requestArgs();
    args.request = new Request(
      "http://localhost/x/users/employees/new?sort=name"
    );
    let redirect: unknown;
    try {
      await redirectLoader(args);
    } catch (error) {
      redirect = error;
    }
    expect(redirect).toBeInstanceOf(Response);
    expect((redirect as Response).headers.get("Location")).toBe(
      "/x/users/employees/bulk-invite?sort=name"
    );
    expect(mocks.requirePermissions).toHaveBeenCalledWith(args.request, {
      create: "users"
    });
  });
});
