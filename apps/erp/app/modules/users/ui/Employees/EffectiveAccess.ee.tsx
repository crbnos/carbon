// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Level } from "@carbon/database/access";
import { Badge, Table, Tbody, Td, Th, Thead, Tr } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";

export type EffectiveAccessRow = {
  page: string;
  label: string;
  level: Level;
  source: "admin" | "person" | "role" | "key" | null;
  scope: "page" | "module" | null;
  gained: string[];
};

/** What a person can do on each page, as saved, and what decides it. */
const EffectiveAccess = ({ rows }: { rows: EffectiveAccessRow[] }) => {
  const { t } = useLingui();
  const levelLabel: Record<Level, string> = {
    None: t`None`,
    View: t`View`,
    Create: t`Create`,
    Edit: t`Edit`,
    Full: t`Full`
  };
  const sourceLabel = (row: EffectiveAccessRow) => {
    if (row.source === "admin") return t`Admin employee type`;
    if (row.source === "person")
      return row.scope === "page" ? t`Override on this page` : t`Override`;
    if (row.source === "role")
      return row.scope === "page" ? t`Role, this page` : t`Role`;
    return t`No grant`;
  };

  return (
    <div className="w-full">
      <label className="block text-sm font-medium leading-none mb-2">
        <Trans>Current access</Trans>
      </label>
      <div className="rounded-md border overflow-hidden max-md:overflow-x-auto max-md:scroll-fade-x">
        <Table>
          <Thead>
            <Tr>
              <Th>
                <Trans>Page</Trans>
              </Th>
              <Th>
                <Trans>Level</Trans>
              </Th>
              <Th>
                <Trans>From</Trans>
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            {rows.map((row) => (
              <Tr key={row.page}>
                <Td className="text-sm font-medium">{row.label}</Td>
                <Td className="text-sm">{levelLabel[row.level]}</Td>
                <Td className="text-sm text-muted-foreground">
                  <div className="flex flex-wrap items-center gap-2">
                    <span>{sourceLabel(row)}</span>
                    {row.gained.length > 0 ? (
                      <Badge variant="yellow">
                        {t`Gained ${row.gained.join(", ")} in the conversion`}
                      </Badge>
                    ) : null}
                  </div>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>
    </div>
  );
};

export default EffectiveAccess;
