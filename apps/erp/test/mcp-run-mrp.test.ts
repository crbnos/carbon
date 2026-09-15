import { describe, expect, it, vi } from "vitest";

// Regression for the production_runMRP userId dispatch bug: production.service.ts's
// runMRP requires userId inside its merged `params` object, but the generic MCP
// dispatch's enrichWithAuthContext/AuthField only know createdBy/updatedBy/companyId/
// companyGroupId -- never a bare "userId" -- so every non-UI caller failed with a Zod
// error on a field their schema never told them to supply. The fix wraps runMRP in
// production.mcp.server.ts with the same positional companyId/userId shape scheduleJob
// already uses, which the dispatcher's serviceParams loop injects unconditionally.

const runMRPService = vi.fn();

vi.mock("~/modules/production/production.service", () => ({
  runMRP: (...args: unknown[]) => runMRPService(...args)
}));
vi.mock("~/services/database.server", () => ({
  getDatabaseClient: () => ({ kysely: true }) as never
}));
// production.mcp.server.ts statically imports these for its OTHER exports
// (scheduleJob/completeJob/issueMaterial) -- unused by runMRP, but the module's
// top-level imports still evaluate them, and the real @carbon/glossary chain
// they pull in needs the lingui macro transform this test doesn't run under.
vi.mock("@carbon/auth", () => ({ hasPermission: vi.fn() }));
vi.mock("@carbon/auth/users.server", () => ({ getUserClaims: vi.fn() }));
vi.mock("@carbon/ee/storage-rules.server", () => ({
  evaluateLinesForSurface: vi.fn(),
  isBlocked: vi.fn()
}));

import { runMRP } from "~/modules/production/production.mcp.server";

describe("MCP runMRP dispatch", () => {
  it("resolves companyId/userId from the positional params the dispatcher injects, not from args", async () => {
    runMRPService.mockResolvedValue({ data: { ok: true }, error: null });

    const client = {} as never;
    await runMRP(client, "company-1", "user-1", {
      type: "job",
      id: "job-1"
    });

    // The underlying service still gets (client, db, params) with companyId/userId
    // populated from the wrapper's own positional args -- never undefined, and never
    // read off the caller-supplied `args` (which has no userId/companyId fields).
    expect(runMRPService).toHaveBeenCalledWith(
      client,
      { kysely: true },
      {
        type: "job",
        id: "job-1",
        companyId: "company-1",
        userId: "user-1"
      }
    );
  });

  it("passes the type/id args through untouched alongside the injected identity fields", async () => {
    runMRPService.mockResolvedValue({ data: { ok: true }, error: null });

    await runMRP({} as never, "c2", "u2", {
      type: "purchaseOrder",
      id: "po-1"
    });

    const [, , params] = runMRPService.mock.calls.at(-1)!;
    expect(params).toEqual({
      type: "purchaseOrder",
      id: "po-1",
      companyId: "c2",
      userId: "u2"
    });
  });
});
