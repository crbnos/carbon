import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: { CONTROLLED_ENVIRONMENT: false },
  assertIsPost: vi.fn(),
  requirePermissions: vi.fn(),
  companyHasFeature: vi.fn(),
  validate: vi.fn(),
  createEmployeeAccount: vi.fn(),
  getSsoInviteDomainError: vi.fn(),
  getSsoAwareInviteLink: vi.fn(),
  sendEmail: vi.fn(),
  invalidate: vi.fn(),
  from: vi.fn(),
  adminSelect: vi.fn(),
  adminEq: vi.fn(),
  adminMaybeSingle: vi.fn()
}));

vi.mock("@carbon/auth", () => ({
  get CONTROLLED_ENVIRONMENT() {
    return mocks.auth.CONTROLLED_ENVIRONMENT;
  },
  assertIsPost: mocks.assertIsPost,
  success: (message: string) => ({ message })
}));
vi.mock("@carbon/auth/auth.server", () => ({
  requirePermissions: mocks.requirePermissions
}));
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => ({})
}));
vi.mock("@carbon/auth/session.server", () => ({ flash: async () => ({}) }));
vi.mock("@carbon/documents/email", () => ({ InviteEmail: () => null }));
vi.mock("@carbon/ee/plan.server", () => ({
  companyHasFeature: mocks.companyHasFeature
}));
vi.mock("@carbon/ee/sso.server", () => ({
  getSsoAwareInviteLink: mocks.getSsoAwareInviteLink
}));
vi.mock("@carbon/form", () => ({
  validator: () => ({ validate: mocks.validate }),
  validationError: (error: unknown) => ({ error })
}));
vi.mock("@carbon/lib/email.server", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@carbon/logger", () => ({ getLogger: () => ({ error: vi.fn() }) }));
vi.mock("@carbon/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@carbon/utils")>()),
  datetime: { timestamp: () => "2026-09-27T00:00:00Z" }
}));
vi.mock("@react-email/components", () => ({ render: async () => "email" }));
vi.mock("~/modules/users", async () => ({
  ...(await import("../app/modules/users/users.models")),
  BulkInviteEmployeesModal: () => null
}));
vi.mock("~/modules/users/users.server", () => ({
  createEmployeeAccount: mocks.createEmployeeAccount,
  getSsoInviteDomainError: mocks.getSsoInviteDomainError
}));
vi.mock("~/utils/react-query", () => ({
  getCompanyId: () => "company-a",
  invalidateUserSelectQueries: mocks.invalidate
}));
vi.mock("~/utils/path", () => ({
  path: {
    to: {
      bulkInviteEmployees: "/x/users/employees/bulk-invite",
      employeeAccounts: "/x/users/employees"
    }
  }
}));

import { action, clientAction, loader } from "../app/routes/x+/users+/employees.bulk-invite";
import { loader as redirectLoader } from "../app/routes/x+/users+/employees.new";

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
  if (!("results" in result)) throw new Error("Expected invitation results");
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
    const query = {
      select: () => query,
      eq: () => query,
      single: async () => ({
        data: table === "company"
          ? { name: "Company A" }
          : { email: "inviter@example.com", fullName: "Inviter" }
      })
    };
    return query;
  });
  mocks.requirePermissions.mockResolvedValue({
    client: { from: mocks.from },
    companyId: "company-a",
    userId: "inviter-a"
  });
  mocks.companyHasFeature.mockResolvedValue(false);
  mocks.validate.mockResolvedValue({
    data: { employees: [employee("row-a", "submitted-a"), employee("row-b", "submitted-b")] }
  });
  mocks.createEmployeeAccount.mockResolvedValue({ success: true, code: "invite-code" });
  mocks.getSsoInviteDomainError.mockResolvedValue(null);
  mocks.getSsoAwareInviteLink.mockResolvedValue("http://localhost/invite/code");
  mocks.sendEmail.mockResolvedValue({ error: null });
});

describe("bulk invite upstream role policy", () => {
  it("stops before all downstream operations when create permission is denied", async () => {
    mocks.requirePermissions.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(action(requestArgs())).rejects.toThrow("Forbidden");
    expect(mocks.validate).not.toHaveBeenCalled();
    expect(mocks.companyHasFeature).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.createEmployeeAccount).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("uses the company Admin type for all gated rows and looks it up once", async () => {
    await expect(action(requestArgs())).rejects.toBeInstanceOf(Response);
    expect(mocks.assertIsPost).toHaveBeenCalledOnce();
    expect(mocks.requirePermissions).toHaveBeenCalledWith(expect.any(Request), { create: "users" });
    expect(mocks.companyHasFeature).toHaveBeenCalledWith(
      expect.any(Object), "company-a", { feature: "PERMISSIONS" }
    );
    expect(mocks.companyHasFeature).toHaveBeenCalledOnce();
    expect(mocks.adminMaybeSingle).toHaveBeenCalledOnce();
    expect(mocks.adminEq.mock.calls).toEqual([
      ["companyId", "company-a"], ["systemType", "Admin"]
    ]);
    expect(mocks.createEmployeeAccount.mock.calls.map(([, args]) => args.employeeType)).toEqual(["admin-a", "admin-a"]);
    for (const [, args] of mocks.createEmployeeAccount.mock.calls) {
      expect(args).toMatchObject({ companyId: "company-a", createdBy: "inviter-a" });
    }
  });

  it("preserves the selected type for each ungated row", async () => {
    mocks.companyHasFeature.mockResolvedValue(true);
    await expect(action(requestArgs())).rejects.toBeInstanceOf(Response);
    expect(mocks.adminMaybeSingle).not.toHaveBeenCalled();
    expect(mocks.createEmployeeAccount.mock.calls.map(([, args]) => args.employeeType)).toEqual(["submitted-a", "submitted-b"]);
  });

  it("preserves upstream fallback when no seeded Admin is found", async () => {
    mocks.adminMaybeSingle.mockResolvedValue({ data: null });
    await expect(action(requestArgs())).rejects.toBeInstanceOf(Response);
    expect(mocks.createEmployeeAccount.mock.calls.map(([, args]) => args.employeeType)).toEqual(["submitted-a", "submitted-b"]);
  });

  it("does not invite or email rows lacking controlled-environment attestation", async () => {
    mocks.auth.CONTROLLED_ENVIRONMENT = true;
    const result = await action(requestArgs());
    expect(inviteResults(result).map((row) => row.success)).toEqual([false, false]);
    expect(mocks.createEmployeeAccount).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("preserves SSO rejection and stable partial-failure row IDs", async () => {
    mocks.getSsoInviteDomainError
      .mockResolvedValueOnce("Outside SSO domain")
      .mockResolvedValueOnce(null);
    const result = await action(requestArgs());
    expect(inviteResults(result)).toMatchObject([
      { rowId: "row-a", success: false, message: "Outside SSO domain" },
      { rowId: "row-b", success: true }
    ]);
    expect(mocks.createEmployeeAccount).toHaveBeenCalledOnce();
    expect(mocks.createEmployeeAccount.mock.calls[0][1].email).toBe("row-b@example.com");
    expect(mocks.sendEmail).toHaveBeenCalledOnce();
  });

  it("keeps failed deliveries as failed invitation rows", async () => {
    mocks.sendEmail.mockResolvedValue({ error: { message: "SMTP refused" } });
    const result = await action(requestArgs());
    expect(inviteResults(result)).toMatchObject([
      { rowId: "row-a", success: false, message: "Created, but invite email failed to send" },
      { rowId: "row-b", success: false, message: "Created, but invite email failed to send" }
    ]);
  });

  it("stops before role lookups and writes when validation fails", async () => {
    mocks.validate.mockResolvedValue({ error: { fieldErrors: { employees: "Invalid" } } });
    expect(await action(requestArgs())).toHaveProperty("error");
    expect(mocks.companyHasFeature).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.createEmployeeAccount).not.toHaveBeenCalled();
  });

  it("continues subsequent rows after email transport throws", async () => {
    mocks.sendEmail.mockRejectedValueOnce(new Error("SMTP disconnected"));
    const result = await action(requestArgs());
    expect(inviteResults(result)).toMatchObject([
      { rowId: "row-a", success: false, message: "Created, but invite email failed to send" },
      { rowId: "row-b", success: true }
    ]);
    expect(mocks.createEmployeeAccount).toHaveBeenCalledTimes(2);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
  });

  it("checks create permission for the bulk loader", async () => {
    await loader(requestArgs());
    expect(mocks.requirePermissions).toHaveBeenCalledWith(expect.any(Request), { create: "users" });
  });

  it("preserves the permission-checked legacy redirect and query string", async () => {
    const args = requestArgs();
    args.request = new Request("http://localhost/x/users/employees/new?sort=name");
    let redirect: unknown;
    try {
      await redirectLoader(args);
    } catch (error) {
      redirect = error;
    }
    expect(redirect).toBeInstanceOf(Response);
    expect((redirect as Response).headers.get("Location")).toBe("/x/users/employees/bulk-invite?sort=name");
    expect(mocks.requirePermissions).toHaveBeenCalledWith(args.request, { create: "users" });
  });

  it("invalidates company-scoped cached users even when serverAction throws", async () => {
    await expect(clientAction({ ...requestArgs(), serverAction: async () => { throw new Error("failed"); } })).rejects.toThrow("failed");
    expect(mocks.invalidate).toHaveBeenCalledWith("company-a");
  });
});
