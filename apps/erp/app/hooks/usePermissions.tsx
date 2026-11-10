// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  ACTIONS,
  anyOf,
  type ExpandedClaims,
  type Gate,
  type GateLevel,
  holdsGate,
  ownsCompany,
  pagesOf
} from "@carbon/database/access";
import { useRouteData } from "@carbon/react";
import { useCallback } from "react";
import type { Role } from "~/types";
import { path } from "~/utils/path";
import { useUser } from "./useUser";

export function usePermissions() {
  const data = useRouteData<{
    permissions: ExpandedClaims;
    role: Role | null;
  }>(path.to.authenticatedRoot);

  const {
    id: userId,
    company: { id: companyId, ownerId }
  } = useUser();

  if (!isPermissions(data?.permissions) || !data?.role) {
    throw new Error(
      "usePermissions must be used within an authenticated route. If you are seeing this error, you are likely in development and have changed the session variables. Try deleting the cookies."
    );
  }

  const has = useCallback(
    (gate: Gate) => holdsGate(data?.permissions ?? {}, gate, companyId),
    [companyId, data?.permissions]
  );

  /** Whether any page of the module holds the level (navigation, dashboards). */
  const hasAny = useCallback(
    (module: string, level: GateLevel) =>
      holdsGate(
        data?.permissions ?? {},
        anyOf(pagesOf(module), level),
        companyId
      ),
    [companyId, data?.permissions]
  );

  const is = useCallback(
    (role: Role) => {
      return data?.role === role;
    },
    [data?.role]
  );

  const isOwner = useCallback(() => {
    return ownsCompany(ownerId, userId);
  }, [ownerId, userId]);

  return {
    has,
    hasAny,
    is,
    isOwner
  };
}

function isPermissions(value: unknown): value is ExpandedClaims {
  if (
    typeof value === "object" &&
    Array.isArray(value) === false &&
    value !== null
  ) {
    return Object.values(value as object).every((permission) =>
      ACTIONS.every((action) => action in permission)
    );
  } else {
    return false;
  }
}
