import { useCallback, useMemo, useState } from "react";
import type { CompanyPermission } from "~/modules/users";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PermissionAction = "view" | "create" | "update" | "delete";

/**
 * Module definitions: a map of module name to its allowed CRUD actions.
 * Example: { accounting: ["view", "create", "update"], sales: ["view", "create", "update", "delete"] }
 */
export type ModuleDefinition = Record<string, readonly PermissionAction[]>;

export type UsePermissionMatrixOptions = {
  /** Module definitions: { moduleName: ["view", "create", ...] } */
  modules: ModuleDefinition;
  /** Initial permission state as a flat boolean map (e.g. { "sales_view": true }) */
  initialState?: Record<string, boolean>;
};

export type UsePermissionMatrixReturn = {
  /** Current permissions as flat boolean map */
  permissions: Record<string, boolean>;
  /** Sorted module entries: [moduleName, actions[]][] */
  modules: [string, readonly PermissionAction[]][];
  /** All available actions */
  actions: readonly PermissionAction[];
  /** Check if a specific permission is enabled */
  isChecked: (module: string, action: string) => boolean;
  /** Toggle a single cell */
  toggleCell: (module: string, action: string) => void;
  /** Toggle all actions for a module row */
  toggleRow: (module: string) => void;
  /** Toggle all permissions globally */
  toggleAll: () => void;
  /** Whether all permissions are checked */
  allChecked: boolean;
  /** Whether some (but not all) permissions are checked */
  someChecked: boolean;
  /** Whether all actions in a specific module row are checked */
  isRowAllChecked: (module: string) => boolean;
  /** Whether some (but not all) actions in a module row are checked */
  isRowIndeterminate: (module: string) => boolean;
  /** Whether a module supports a specific action */
  hasAction: (module: string, action: string) => boolean;
  /** Set permissions state directly */
  setPermissions: (permissions: Record<string, boolean>) => void;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_ACTIONS: readonly PermissionAction[] = [
  "view",
  "create",
  "update",
  "delete"
] as const;

/** Modules that should be hidden from all permission UIs */
const HIDDEN_MODULES = new Set(["messaging", "items", "timecards"]);

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePermissionMatrix({
  modules,
  initialState
}: UsePermissionMatrixOptions): UsePermissionMatrixReturn {
  const sortedModules = useMemo<[string, readonly PermissionAction[]][]>(
    () =>
      Object.entries(modules).sort(([a], [b]) => a.localeCompare(b)) as [
        string,
        readonly PermissionAction[]
      ][],
    [modules]
  );

  const [permissions, setPermissionsRaw] = useState<Record<string, boolean>>(
    () => initialState ?? buildDefaultState(modules)
  );

  const setPermissions = useCallback(
    (next: Record<string, boolean>) => setPermissionsRaw(next),
    []
  );

  // Derived state
  const allKeys = useMemo(() => Object.keys(permissions), [permissions]);
  const allChecked = useMemo(
    () => allKeys.length > 0 && allKeys.every((k) => permissions[k]),
    [allKeys, permissions]
  );
  const someChecked = useMemo(
    () => allKeys.some((k) => permissions[k]),
    [allKeys, permissions]
  );

  const isChecked = useCallback(
    (mod: string, action: string) => permissions[`${mod}_${action}`] ?? false,
    [permissions]
  );

  const hasAction = useCallback(
    (mod: string, action: string) =>
      (modules[mod] as readonly string[] | undefined)?.includes(action) ??
      false,
    [modules]
  );

  const toggleCell = useCallback((mod: string, action: string) => {
    const key = `${mod}_${action}`;
    setPermissionsRaw((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const toggleRow = useCallback(
    (mod: string) => {
      setPermissionsRaw((prev) => {
        const moduleActions = modules[mod] ?? [];
        const rowKeys = moduleActions.map((a) => `${mod}_${a}`);
        const allRowChecked = rowKeys.every((k) => prev[k]);
        const next = { ...prev };
        for (const k of rowKeys) {
          next[k] = !allRowChecked;
        }
        return next;
      });
    },
    [modules]
  );

  const toggleAll = useCallback(() => {
    setPermissionsRaw((prev) => {
      const keys = Object.keys(prev);
      const currentAllChecked = keys.length > 0 && keys.every((k) => prev[k]);
      const next: Record<string, boolean> = {};
      for (const k of keys) {
        next[k] = !currentAllChecked;
      }
      return next;
    });
  }, []);

  const isRowAllChecked = useCallback(
    (mod: string) => {
      const moduleActions = modules[mod] ?? [];
      return (
        moduleActions.length > 0 &&
        moduleActions.every((a) => permissions[`${mod}_${a}`])
      );
    },
    [modules, permissions]
  );

  const isRowIndeterminate = useCallback(
    (mod: string) => {
      const moduleActions = modules[mod] ?? [];
      const some = moduleActions.some((a) => permissions[`${mod}_${a}`]);
      const all = moduleActions.every((a) => permissions[`${mod}_${a}`]);
      return some && !all;
    },
    [modules, permissions]
  );

  return {
    permissions,
    modules: sortedModules,
    actions: ALL_ACTIONS,
    isChecked,
    toggleCell,
    toggleRow,
    toggleAll,
    allChecked,
    someChecked,
    isRowAllChecked,
    isRowIndeterminate,
    hasAction,
    setPermissions
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a default all-false state from module definitions */
function buildDefaultState(modules: ModuleDefinition): Record<string, boolean> {
  const state: Record<string, boolean> = {};
  for (const [mod, actions] of Object.entries(modules)) {
    for (const action of actions) {
      state[`${mod}_${action}`] = false;
    }
  }
  return state;
}

// ---------------------------------------------------------------------------
// Adapter: API Key scopes
// ---------------------------------------------------------------------------

/** Convert flat boolean map → JSONB scopes format { "sales_view": ["<companyId>"], ... } */
export function toApiKeyScopes(
  permissions: Record<string, boolean>,
  companyId: string
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [key, enabled] of Object.entries(permissions)) {
    if (enabled) {
      result[key] = [companyId];
    }
  }
  return result;
}

/** Convert JSONB scopes format → flat boolean map (empty scopes = no access) */
export function fromApiKeyScopes(
  scopes: Record<string, string[]> | null | undefined,
  modules: ModuleDefinition
): Record<string, boolean> {
  const state = buildDefaultState(modules);
  if (!scopes || Object.keys(scopes).length === 0) {
    return state;
  }
  for (const key of Object.keys(scopes)) {
    if (key in state) {
      state[key] = true;
    }
  }
  return state;
}

// ---------------------------------------------------------------------------
// Adapter: CompanyPermission (employee permissions, bulk edit)
// ---------------------------------------------------------------------------

/** Convert flat boolean map → Record<string, CompanyPermission> */
export function toCompanyPermissions(
  permissions: Record<string, boolean>
): Record<string, CompanyPermission> {
  const result: Record<string, CompanyPermission> = {};
  for (const [key, enabled] of Object.entries(permissions)) {
    const lastUnderscore = key.lastIndexOf("_");
    if (lastUnderscore === -1) continue;
    const mod = key.slice(0, lastUnderscore);
    const action = key.slice(lastUnderscore + 1);
    if (!result[mod]) {
      result[mod] = {
        view: false,
        create: false,
        update: false,
        delete: false
      };
    }
    if (action in result[mod]) {
      result[mod][action as keyof CompanyPermission] = enabled;
    }
  }
  return result;
}

/** Convert Record<string, CompanyPermission> → flat boolean map + derived ModuleDefinition */
export function fromCompanyPermissions(
  permissions: Record<string, CompanyPermission>
): { state: Record<string, boolean>; modules: ModuleDefinition } {
  const state: Record<string, boolean> = {};
  const modules: ModuleDefinition = {};
  for (const [mod, perm] of Object.entries(permissions)) {
    if (HIDDEN_MODULES.has(mod)) continue;
    const actions: PermissionAction[] = ["view", "create", "update", "delete"];
    modules[mod] = actions;
    for (const action of actions) {
      state[`${mod}_${action}`] = perm[action];
    }
  }
  return { state, modules };
}

// ---------------------------------------------------------------------------
// Adapter: Employee type permissions ({ name, permission } shape)
// ---------------------------------------------------------------------------

/** Convert flat boolean map → Record<string, { name: string; permission: CompanyPermission }> */
export function toEmployeeTypePermissions(
  permissions: Record<string, boolean>
): Record<string, { name: string; permission: CompanyPermission }> {
  const company = toCompanyPermissions(permissions);
  const result: Record<
    string,
    { name: string; permission: CompanyPermission }
  > = {};
  for (const [mod, perm] of Object.entries(company)) {
    result[mod] = { name: mod, permission: perm };
  }
  return result;
}

/** Convert Record<string, { name: string; permission: CompanyPermission }> → flat boolean map + derived ModuleDefinition */
export function fromEmployeeTypePermissions(
  permissions: Record<string, { name: string; permission: CompanyPermission }>
): { state: Record<string, boolean>; modules: ModuleDefinition } {
  const state: Record<string, boolean> = {};
  const modules: ModuleDefinition = {};
  for (const [mod, data] of Object.entries(permissions)) {
    if (HIDDEN_MODULES.has(mod)) continue;
    const actions: PermissionAction[] = ["view", "create", "update", "delete"];
    modules[mod] = actions;
    for (const action of actions) {
      state[`${mod}_${action}`] = data.permission[action];
    }
  }
  return { state, modules };
}
