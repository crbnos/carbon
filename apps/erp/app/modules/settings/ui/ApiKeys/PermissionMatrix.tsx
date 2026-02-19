import { Checkbox, Table, Tbody, Td, Th, Thead, Tr } from "@carbon/react";
import { apiKeyPermissionModules } from "~/modules/settings";
import { capitalize } from "~/utils/string";

export type ApiKeyScopes = Record<string, boolean>;

type PermissionMatrixProps = {
  scopes: ApiKeyScopes;
  onChange: (scopes: ApiKeyScopes) => void;
};

const actions = ["view", "create", "update", "delete"] as const;

const modules = Object.entries(apiKeyPermissionModules).sort(([a], [b]) =>
  a.localeCompare(b)
);

/**
 * Build the full set of scope keys from the module definitions.
 * e.g., { accounting_view: false, accounting_create: false, ... }
 */
export function getDefaultScopes(): ApiKeyScopes {
  const scopes: ApiKeyScopes = {};
  for (const [mod, acts] of Object.entries(apiKeyPermissionModules)) {
    for (const action of acts) {
      scopes[`${mod}_${action}`] = false;
    }
  }
  return scopes;
}

/** Convert all scopes to true (full access) */
export function getFullAccessScopes(): ApiKeyScopes {
  const scopes = getDefaultScopes();
  for (const key of Object.keys(scopes)) {
    scopes[key] = true;
  }
  return scopes;
}

/** Convert ApiKeyScopes (boolean map) to JSONB format { "sales_view": ["<companyId>"], ... } */
export function scopesToJsonb(
  scopes: ApiKeyScopes,
  companyId: string
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [key, enabled] of Object.entries(scopes)) {
    if (enabled) {
      result[key] = [companyId];
    }
  }
  return result;
}

/** Convert JSONB format back to ApiKeyScopes (boolean map) */
export function jsonbToScopes(
  jsonb: Record<string, string[]> | null | undefined
): ApiKeyScopes {
  const scopes = getDefaultScopes();
  if (!jsonb || Object.keys(jsonb).length === 0) {
    return getFullAccessScopes();
  }
  for (const key of Object.keys(jsonb)) {
    if (key in scopes) {
      scopes[key] = true;
    }
  }
  return scopes;
}

const PermissionMatrix = ({ scopes, onChange }: PermissionMatrixProps) => {
  const allKeys = Object.keys(scopes);
  const allChecked = allKeys.every((k) => scopes[k]);
  const someChecked = allKeys.some((k) => scopes[k]);

  const toggleAll = (checked: boolean) => {
    const next: ApiKeyScopes = {};
    for (const key of allKeys) {
      next[key] = checked;
    }
    onChange(next);
  };

  const toggleRow = (mod: string, checked: boolean) => {
    const next = { ...scopes };
    const moduleActions =
      apiKeyPermissionModules[mod as keyof typeof apiKeyPermissionModules] ??
      [];
    for (const action of moduleActions) {
      next[`${mod}_${action}`] = checked;
    }
    onChange(next);
  };

  const toggleCell = (key: string, checked: boolean) => {
    onChange({ ...scopes, [key]: checked });
  };

  return (
    <div className="w-full">
      <label className="block text-sm font-medium leading-none mb-2">
        Permissions
      </label>
      <div className="rounded-md border overflow-hidden">
        <Table>
          <Thead>
            <Tr>
              <Th className="w-[140px]">
                <div className="flex items-center gap-2">
                  <Checkbox
                    isChecked={allChecked}
                    isIndeterminate={someChecked && !allChecked}
                    onCheckedChange={(checked) => toggleAll(!!checked)}
                  />
                  <span>Module</span>
                </div>
              </Th>
              {actions.map((action) => {
                return (
                  <Th key={action} className="w-[80px] text-center">
                    <div className="flex flex-col items-center gap-1">
                      <span>{capitalize(action)}</span>
                    </div>
                  </Th>
                );
              })}
            </Tr>
          </Thead>
          <Tbody>
            {modules.map(([mod, moduleActions]) => {
              const rowKeys = moduleActions.map((a: string) => `${mod}_${a}`);
              const rowAllChecked = rowKeys.every((k: string) => scopes[k]);
              const rowSomeChecked = rowKeys.some((k: string) => scopes[k]);

              return (
                <Tr key={mod}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        isChecked={rowAllChecked}
                        isIndeterminate={rowSomeChecked && !rowAllChecked}
                        onCheckedChange={(checked) => toggleRow(mod, !!checked)}
                      />
                      <span className="text-sm font-medium">
                        {capitalize(mod)}
                      </span>
                    </div>
                  </Td>
                  {actions.map((action) => {
                    const key = `${mod}_${action}`;
                    const hasAction = (
                      moduleActions as readonly string[]
                    ).includes(action);

                    return (
                      <Td key={action} className="text-center">
                        {hasAction ? (
                          <Checkbox
                            isChecked={scopes[key] ?? false}
                            onCheckedChange={(checked) =>
                              toggleCell(key, !!checked)
                            }
                          />
                        ) : (
                          <span className="text-muted-foreground pl-6 block">
                            --
                          </span>
                        )}
                      </Td>
                    );
                  })}
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      </div>
    </div>
  );
};

export default PermissionMatrix;
