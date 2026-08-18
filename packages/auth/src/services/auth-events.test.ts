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
    expect(message).toBe("auth.permission_changed");
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

  it("records an unattributed change when actor is missing", () => {
    logPermissionChange({
      targetUserId: "usr_target",
      companyId: COMPANY,
      before: {},
      after: { sales_view: [COMPANY] }
    });
    const [, payload] = info.mock.calls[0]!;
    expect(payload.actor).toBeUndefined();
    expect(payload.granted).toEqual(["sales_view"]);
    expect(payload.revoked).toEqual([]);
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
      reason: "deactivate"
    });

    expect(info).toHaveBeenCalledTimes(1);
    const [message, payload] = info.mock.calls[0]!;
    expect(message).toBe("auth.role_changed");
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
