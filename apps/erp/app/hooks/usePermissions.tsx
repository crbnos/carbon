import { useRouteData } from "@carbon/remix";
import { useCallback } from "react";
import type { Permission } from "~/modules/users";
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
    company: { id: companyId, ownerId },
  } = useUser();

  if (!isPermissions(data?.permissions) || !isRole(data?.role)) {
    // TODO: force logout -- the likely cause is development changes
    throw new Error(
      "usePermissions must be used within an authenticated route. If you are seeing this error, you are likely in development and have changed the session variables. Try deleting the cookies."
    );
  }

  const can = useCallback(
    (action: "view" | "create" | "update" | "delete", feature: string) => {
      return (
        data?.permissions[feature]?.[action].includes("0") ||
        data?.permissions[feature]?.[action].includes(companyId)
      );
    },
    [companyId, data?.permissions]
  );

  const has = useCallback(
    (feature: string) => {
      return !!data?.permissions && feature in data.permissions;
    },
    [data?.permissions]
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
    can,
    has,
    is,
    isOwner,
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
