// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { LEVELS, type Level, PAGES } from "@carbon/database/access";
import { useLoaderQuery } from "@carbon/query";
import {
  Badge,
  HStack,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { path } from "~/utils/path";

type Holders = {
  people: { userId: string; name: string; level: Level; source: string }[];
  apiKeys: { apiKeyId: string; name: string; level: Level }[];
  error: string | null;
};

/** Who reaches a page at a level: every employee, and the API keys. */
const AccessHolders = () => {
  const { t } = useLingui();
  const [page, setPage] = useState<string>(PAGES[0].id);
  const [level, setLevel] = useState<Level>("View");
  const holders = useLoaderQuery<Holders>(
    path.to.api.accessHolders(page, level)
  );

  const levelLabel: Record<Level, string> = {
    None: t`None`,
    View: t`View`,
    Create: t`Create`,
    Edit: t`Edit`,
    Full: t`Full`
  };
  const people = holders.data?.people ?? [];
  const apiKeys = holders.data?.apiKeys ?? [];

  return (
    <div className="w-full">
      <label className="block text-sm font-medium leading-none mb-2">
        <Trans>Who has access</Trans>
      </label>
      <HStack className="mb-2">
        <Select value={page} onValueChange={setPage}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGES.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={level}
          onValueChange={(value) => setLevel(value as Level)}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LEVELS.filter((l) => l !== "None").map((l) => (
              <SelectItem key={l} value={l}>
                {t`${levelLabel[l]} or more`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </HStack>
      <div className="rounded-md border p-3 flex flex-wrap gap-2 min-h-12">
        {people.map((person) => (
          <Badge key={person.userId} variant="secondary">
            {person.name} · {levelLabel[person.level]}
          </Badge>
        ))}
        {apiKeys.map((key) => (
          <Badge key={key.apiKeyId} variant="outline">
            {t`API key ${key.name}`} · {levelLabel[key.level]}
          </Badge>
        ))}
        {!holders.isLoading && people.length + apiKeys.length === 0 ? (
          <span className="text-sm text-muted-foreground">
            <Trans>Nobody</Trans>
          </span>
        ) : null}
      </div>
    </div>
  );
};

export default AccessHolders;
