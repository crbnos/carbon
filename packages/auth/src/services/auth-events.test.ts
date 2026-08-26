import { beforeEach, describe, expect, it, vi } from "vitest";

// Capture logger output without pulling in @logtape. `logAuthEvent` binds the
// logger at module load, so the mock must be hoisted and return a stable object.
const { info, warn, error } = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}));

vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ info, warn, error })
}));

import {
  grantedPermissionKeys,
  logPermissionChange,
  logRoleChange
} from "./auth-events.server";

const COMPANY = "cmp_1";
const OTHER = "cmp_2";

beforeEach(() => {
  info.mockClear();
  warn.mockClear();
  error.mockClear();
});

describe("grantedPermissionKeys", () => {
  it("returns only keys granted for the given company, sorted", () => {
    const permissions = {
      sales_view: [COMPANY, OTHER],
      sales_update: [COMPANY],
      parts_view: [OTHER],
      purchasing_view: []
    };
    expect(grantedPermissionKeys(permissions, COMPANY)).toEqual([
      "sales_update",
      "sales_view"
    ]);
  });

  it("is null/undefined safe", () => {
    expect(grantedPermissionKeys(null, COMPANY)).toEqual([]);
    expect(grantedPermissionKeys(undefined, COMPANY)).toEqual([]);
  });
});

describe("logPermissionChange", () => {
  it("emits permission_changed with actor, target, before/after and deltas", () => {
    logPermissionChange({
      actor: "usr_admin",
      targetUserId: "usr_target",
      companyId: COMPANY,
      before: { sales_view: [COMPANY], parts_view: [COMPANY] },
      after: { sales_view: [COMPANY], purchasing_view: [COMPANY] }
    });

    expect(info).toHaveBeenCalledTimes(1);
    const [message, payload] = info.mock.calls[0]!;
    expect(message).toContain("auth.permission_changed");
    expect(message).toContain("actor=usr_admin");
    expect(payload).toMatchObject({
      authEvent: "permission_changed",
      outcome: "success",
      actor: "usr_admin",
      targetUserId: "usr_target",
      companyId: COMPANY,
      before: ["parts_view", "sales_view"],
      after: ["purchasing_view", "sales_view"],
      granted: ["purchasing_view"],
      revoked: ["parts_view"]
    });
  });

  it("stamps a system actor when actor is missing (never unattributed)", () => {
    logPermissionChange({
      targetUserId: "usr_target",
      companyId: COMPANY,
      before: {},
      after: { sales_view: [COMPANY] }
    });
    const [, payload] = info.mock.calls[0]!;
    expect(payload.actor).toBe("system");
    expect(payload.granted).toEqual(["sales_view"]);
    expect(payload.revoked).toEqual([]);
  });

  it("records the source ip when provided", () => {
    logPermissionChange({
      actor: "usr_admin",
      targetUserId: "usr_target",
      companyId: COMPANY,
      ip: "203.0.113.7",
      before: {},
      after: { sales_view: [COMPANY] }
    });
    const [, payload] = info.mock.calls[0]!;
    expect(payload.ip).toBe("203.0.113.7");
  });
});

describe("logRoleChange", () => {
  it("emits role_changed with role transition and revoked permissions on deactivation", () => {
    logRoleChange({
      actor: "usr_admin",
      targetUserId: "usr_target",
      companyId: COMPANY,
      beforeRole: "employee",
      afterRole: null,
      before: { sales_view: [COMPANY, OTHER], parts_view: [COMPANY] },
      after: { sales_view: [OTHER], parts_view: [] },
      ip: "203.0.113.7",
      reason: "deactivate"
    });

    expect(info).toHaveBeenCalledTimes(1);
    const [message, payload] = info.mock.calls[0]!;
    expect(message).toContain("auth.role_changed");
    expect(message).toContain("ip=203.0.113.7");
    expect(payload).toMatchObject({
      authEvent: "role_changed",
      outcome: "success",
      actor: "usr_admin",
      targetUserId: "usr_target",
      companyId: COMPANY,
      beforeRole: "employee",
      afterRole: null,
      before: ["parts_view", "sales_view"],
      after: [],
      revoked: ["parts_view", "sales_view"],
      ip: "203.0.113.7",
      reason: "deactivate"
    });
  });

  it("omits the permission summary when no before/after maps are given", () => {
    logRoleChange({
      actor: "usr_admin",
      targetUserId: "usr_target",
      companyId: COMPANY,
      beforeRole: "employee",
      afterRole: null
    });
    const [, payload] = info.mock.calls[0]!;
    expect(payload.before).toBeUndefined();
    expect(payload.after).toBeUndefined();
    expect(payload.beforeRole).toBe("employee");
    expect(payload.afterRole).toBeNull();
  });
});
