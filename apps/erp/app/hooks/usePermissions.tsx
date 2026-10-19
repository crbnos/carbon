// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  type Gate,
  type GateLevel,
  holdsAny,
  holdsGate,
  LEVEL_ACTION
} from "@carbon/database/access";
import { useRouteData } from "@carbon/react";
import { useCallback } from "react";
import type { Permission } from "~/modules/users/types";
import type { Role } from "~/types";
import { path } from "~/utils/path";
import { useUser } from "./useUser";

export function usePermissions() {
  const data = useRouteData<{
    permissions: Record<string, Permission>;
    role: "employee" | "supplier" | "customer";
  }>(path.to.authenticatedRoot);

  const {
    id: userId,
    company: { id: companyId, ownerId }
  } = useUser();

  if (!isPermissions(data?.permissions) || !isRole(data?.role)) {
    // TODO: force logout -- the likely cause is development changes
    throw new Error(
      "usePermissions must be used within an authenticated route. If you are seeing this error, you are likely in development and have changed the session variables. Try deleting the cookies."
    );
  }

  /** Whether the person passes the gate: `has({ "sales.quotes": "Edit" })`. */
  const has = useCallback(
    (gate: Gate) => holdsGate(data?.permissions ?? {}, gate, companyId),
    [companyId, data?.permissions]
  );

  /** Whether any page of the module holds the level (navigation, dashboards). */
  const hasAny = useCallback(
    (module: string, level: GateLevel) =>
      holdsAny(data?.permissions ?? {}, module, LEVEL_ACTION[level], companyId),
    [companyId, data?.permissions]
  );

  const is = useCallback(
    (role: Role) => {
      return data?.role === role;
    },
    [data?.role]
  );

  const isOwner = useCallback(() => {
    return ownerId === userId;
  }, [ownerId, userId]);

  return {
    has,
    hasAny,
    is,
    isOwner
  };
}

function isPermissions(value: unknown): value is Record<string, Permission> {
  if (
    typeof value === "object" &&
    Array.isArray(value) === false &&
    value !== null
  ) {
    return Object.values(value as object).every(
      (permission) =>
        "view" in permission &&
        "create" in permission &&
        "update" in permission &&
        "delete" in permission
    );
  } else {
    return false;
  }
}

function isRole(value: unknown): value is Role {
  return value === "employee" || value === "customer" || value === "supplier";
}
