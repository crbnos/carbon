// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { CONTROLLED_ENVIRONMENT, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Avatar,
  Badge,
  Button,
  cn,
  Heading,
  Input,
  InputGroup,
  InputLeftElement,
  useMode
} from "@carbon/react";
import { redirect } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import {
  LuArrowRight,
  LuLoaderCircle,
  LuLogOut,
  LuSearch
} from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData, useNavigation } from "react-router";
import { getEmployeeCompanies } from "~/modules/settings";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {});

  const employeeCompanies = await getEmployeeCompanies(client, userId);

  if (employeeCompanies.error) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(
        request,
        error(employeeCompanies.error, "Failed to get companies")
      )
    );
  }

  // Single-company (or none) users have nothing to pick — go straight in.
  if ((employeeCompanies.data?.length ?? 0) <= 1) {
    throw redirect(path.to.authenticatedRoot);
  }

  const redirectTo = new URL(request.url).searchParams.get("redirectTo");

  return { companies: employeeCompanies.data ?? [], redirectTo };
}

export default function SelectCompany() {
  const { t } = useLingui();
  const mode = useMode();
  const navigation = useNavigation();
  const { companies, redirectTo } = useLoaderData<typeof loader>();
  const isBusy = navigation.state !== "idle";
  const [query, setQuery] = useState("");

  // A group name only tells the companies apart when more than one of the
  // user's companies shares it — mirrors the top-bar CompanySwitcher.
  const sharedGroupNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of companies) {
      if (!c.companyGroupName) continue;
      counts.set(c.companyGroupName, (counts.get(c.companyGroupName) ?? 0) + 1);
    }
    return new Set(
      Array.from(counts)
        .filter(([, count]) => count > 1)
        .map(([name]) => name)
    );
  }, [companies]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter((c) =>
      [c.name, c.companyGroupName, c.employeeType].some((value) =>
        value?.toLowerCase().includes(q)
      )
    );
  }, [companies, query]);

  return (
    <div className="flex min-h-screen w-full flex-col">
      <header className="flex h-[49px] shrink-0 items-center justify-between border-b border-border px-4">
        <img
          src={CONTROLLED_ENVIRONMENT ? "/flag.png" : "/carbon-mark-light.svg"}
          alt="Carbon Logo"
          className={cn(
            "w-6 dark:hidden",
            CONTROLLED_ENVIRONMENT && "grayscale"
          )}
        />
        <img
          src={CONTROLLED_ENVIRONMENT ? "/flag.png" : "/carbon-mark-dark.svg"}
          alt="Carbon Logo"
          className={cn(
            "hidden w-6 dark:block",
            CONTROLLED_ENVIRONMENT && "grayscale"
          )}
        />
        <Form method="post" action={path.to.logout}>
          <Button
            type="submit"
            variant="ghost"
            leftIcon={<LuLogOut />}
            isDisabled={navigation.state !== "idle"}
            isLoading={navigation.formAction === path.to.logout}
          >
            <Trans>Sign Out</Trans>
          </Button>
        </Form>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10 sm:py-14">
        <div className="flex flex-col gap-1">
          <Heading as="h1" size="h3">
            <Trans>Companies</Trans>
          </Heading>
          <p className="text-pretty text-sm text-muted-foreground">
            <Trans>
              You belong to more than one company. Pick where to work.
            </Trans>
          </p>
        </div>

        <InputGroup className="w-full sm:w-72">
          <InputLeftElement>
            <LuSearch className="h-3.5 w-3.5 text-muted-foreground" />
          </InputLeftElement>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t`Search for a company`}
            aria-label={t`Search for a company`}
            className="text-sm"
          />
        </InputGroup>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-border px-6 py-12 text-center">
            <p className="text-sm font-medium">
              <Trans>No companies match "{query}"</Trans>
            </p>
            <p className="text-sm text-muted-foreground">
              <Trans>Try a different name.</Trans>
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((c) => {
              const logo = mode === "dark" ? c.logoDarkIcon : c.logoLightIcon;
              const switchAction = path.to.companySwitch(c.companyId!);
              const isSubmitting =
                isBusy && navigation.formAction === switchAction;
              const groupName =
                c.companyGroupName && sharedGroupNames.has(c.companyGroupName)
                  ? c.companyGroupName
                  : null;
              return (
                <Form key={c.companyId} method="post" action={switchAction}>
                  {redirectTo && (
                    <input type="hidden" name="redirectTo" value={redirectTo} />
                  )}
                  <button
                    type="submit"
                    disabled={isBusy}
                    className="group flex h-full min-h-40 w-full flex-col gap-4 rounded-lg border border-border bg-card p-5 text-left text-card-foreground shadow-sm transition-colors hover:border-foreground/20 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
                  >
                    <div className="flex w-full items-start justify-between gap-3">
                      <Avatar
                        size="md"
                        name={c.name ?? undefined}
                        src={logo ?? undefined}
                        className="shrink-0 outline-1 -outline-offset-1 outline-black/5 dark:outline-white/10"
                      />
                      {isSubmitting ? (
                        <LuLoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground" />
                      ) : (
                        <LuArrowRight className="size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                      )}
                    </div>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <p className="truncate text-sm font-medium">{c.name}</p>
                      {c.employeeType && (
                        <p className="truncate text-sm text-muted-foreground">
                          {c.employeeType}
                        </p>
                      )}
                    </div>
                    {groupName && (
                      <div className="mt-auto flex">
                        <Badge variant="secondary">{groupName}</Badge>
                      </div>
                    )}
                  </button>
                </Form>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
