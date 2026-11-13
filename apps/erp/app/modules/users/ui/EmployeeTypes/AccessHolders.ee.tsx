// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import {
  ACTIONS,
  LEVELS,
  type Level,
  levelHolds,
  MODULES,
  moduleOf,
  PAGES
} from "@carbon/database/access";
import { useLoaderQuery } from "@carbon/query";
import {
  Avatar,
  cn,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuKeyRound } from "react-icons/lu";
import type { loader } from "~/routes/api+/users.access-holders";
import { path } from "~/utils/path";
import { useLevelWord } from "../components/AccessGrid.ee";

/** A holder's level as the grid draws it: four steps, filled up to the level. */
const Meter = ({ level, label }: { level: Level; label: string }) => (
  <span
    role="img"
    aria-label={label}
    title={label}
    className="flex w-16 shrink-0 gap-0.5"
  >
    {ACTIONS.map((action) => (
      <span
        key={action}
        className={cn(
          "h-1.5 flex-1 rounded-full",
          levelHolds(level, action) ? "bg-primary" : "bg-foreground/10"
        )}
      />
    ))}
  </span>
);

/** Who reaches a page at a level: every employee, and the API keys. */
const AccessHolders = () => {
  const { t } = useLingui();
  const [page, setPage] = useState<string>(PAGES[0].id);
  const [level, setLevel] = useState<Level>("View");
  const holders = useLoaderQuery<typeof loader>(
    path.to.api.accessHolders(page, level)
  );

  // The grid's own words: a level is the last box it ticks.
  const can: Record<Level, string> = {
    None: t`None`,
    View: t`can view`,
    Create: t`can create`,
    Edit: t`can update`,
    Full: t`can delete`
  };
  const levelWord = useLevelWord();
  const from: Record<string, string> = {
    admin: t`Admin`,
    person: t`Override`,
    role: t`Role`
  };
  const people = holders.data?.people ?? [];
  const apiKeys = holders.data?.apiKeys ?? [];

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
        <Trans>Who</Trans>
        <Select value={level} onValueChange={(v) => setLevel(v as Level)}>
          <SelectTrigger className="h-8 w-auto gap-2">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LEVELS.filter((l) => l !== "None").map((l) => (
              <SelectItem key={l} value={l}>
                {can[l]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Trans>in</Trans>
        <Select value={page} onValueChange={setPage}>
          <SelectTrigger className="h-8 w-auto gap-2">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODULES.map((module) => (
              <SelectGroup key={module.id}>
                <SelectLabel>{module.label}</SelectLabel>
                {PAGES.filter((p) => moduleOf(p.id) === module.id).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>
      <ul className="divide-y rounded-lg border">
        {people.map((person) => (
          <li
            key={person.userId}
            className="flex items-center gap-3 px-4 py-2.5 text-sm"
          >
            <Avatar size="xs" name={person.name} />
            <span className="min-w-0 flex-1 truncate">{person.name}</span>
            <span className="text-xs text-muted-foreground">
              {from[person.source] ?? person.source}
            </span>
            <Meter level={person.level} label={levelWord(person.level)} />
          </li>
        ))}
        {apiKeys.map((key) => (
          <li
            key={key.apiKeyId}
            className="flex items-center gap-3 px-4 py-2.5 text-sm"
          >
            <span className="flex size-6 items-center justify-center rounded-full bg-muted">
              <LuKeyRound className="size-3 text-muted-foreground" />
            </span>
            <span className="min-w-0 flex-1 truncate">{key.name}</span>
            <span className="text-xs text-muted-foreground">
              <Trans>API key</Trans>
            </span>
            <Meter level={key.level} label={levelWord(key.level)} />
          </li>
        ))}
        {!holders.isLoading && people.length + apiKeys.length === 0 ? (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">
            <Trans>Nobody yet.</Trans>
          </li>
        ) : null}
      </ul>
    </section>
  );
};

export default AccessHolders;
