import { CONTROLLED_ENVIRONMENT, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Avatar, cn, ScrollArea, useMode } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { LuChevronRight, LuLoaderCircle } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData, useNavigation } from "react-router";
import type { Company } from "~/modules/settings";
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

  const companiesLabel = t`Companies`;

  const groups = useMemo(() => {
    // Group by company group, then fold any single-company group into the
    // generic "Companies" bucket — mirrors the top-bar CompanySwitcher.
    const byGroup = new Map<string, { name: string; companies: Company[] }>();
    for (const c of companies) {
      const name = c.companyGroupName ?? companiesLabel;
      const existing = byGroup.get(name);
      if (existing) existing.companies.push(c);
      else byGroup.set(name, { name, companies: [c] });
    }

    const result = new Map<string, { name: string; companies: Company[] }>();
    for (const [name, group] of byGroup) {
      const target =
        group.companies.length === 1 && name !== companiesLabel
          ? companiesLabel
          : name;
      const existing = result.get(target);
      if (existing) existing.companies.push(...group.companies);
      else
        result.set(target, { name: target, companies: [...group.companies] });
    }

    return Array.from(result.values());
  }, [companies, companiesLabel]);

  return (
    <div className="w-full max-w-[26rem] overflow-hidden rounded-2xl bg-card text-card-foreground shadow-2xl ring-1 ring-black/5 antialiased dark:ring-white/10">
      <div className="flex flex-col items-center gap-4 px-8 pb-6 pt-9">
        <img
          src={CONTROLLED_ENVIRONMENT ? "/flag.png" : "/carbon-mark-light.svg"}
          alt="Carbon Logo"
          className={cn(
            "w-10 dark:hidden",
            CONTROLLED_ENVIRONMENT && "grayscale"
          )}
        />
        <img
          src={CONTROLLED_ENVIRONMENT ? "/flag.png" : "/carbon-mark-dark.svg"}
          alt="Carbon Logo"
          className={cn(
            "hidden w-10 dark:block",
            CONTROLLED_ENVIRONMENT && "grayscale"
          )}
        />
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-lg font-semibold tracking-tight">
            <Trans>Choose a company</Trans>
          </h1>
          <p className="text-pretty text-sm text-muted-foreground">
            <Trans>
              You belong to more than one company. Pick where to work.
            </Trans>
          </p>
        </div>
      </div>

      <ScrollArea className="max-h-[24rem] px-3">
        <div className="flex flex-col gap-1 pb-2">
          {groups.map((group, index) => {
            const showLabel =
              group.name !== companiesLabel && group.companies.length > 1;
            return (
              <div
                key={group.name}
                className={cn("flex flex-col", index > 0 && "pt-2")}
              >
                {showLabel && (
                  <div className="px-3 pb-1 pt-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {group.name}
                  </div>
                )}
                {group.companies.map((c) => {
                  const logo =
                    mode === "dark" ? c.logoDarkIcon : c.logoLightIcon;
                  const switchAction = path.to.companySwitch(c.companyId!);
                  const isSubmitting =
                    isBusy && navigation.formAction === switchAction;
                  return (
                    <Form key={c.companyId} method="post" action={switchAction}>
                      {redirectTo && (
                        <input
                          type="hidden"
                          name="redirectTo"
                          value={redirectTo}
                        />
                      )}
                      <button
                        type="submit"
                        disabled={isBusy}
                        className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:pointer-events-none disabled:opacity-60"
                      >
                        <Avatar
                          size="md"
                          name={c.name ?? undefined}
                          src={logo ?? undefined}
                          className="shrink-0 outline-1 -outline-offset-1 outline-black/5 dark:outline-white/10"
                        />
                        <div className="flex min-w-0 flex-1 flex-col">
                          <p className="truncate text-sm font-medium">
                            {c.name}
                          </p>
                          {c.employeeType && (
                            <p className="truncate text-xs text-muted-foreground">
                              {c.employeeType}
                            </p>
                          )}
                        </div>
                        {isSubmitting ? (
                          <LuLoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground" />
                        ) : (
                          <LuChevronRight className="size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" />
                        )}
                      </button>
                    </Form>
                  );
                })}
              </div>
            );
          })}
        </div>
      </ScrollArea>

      <div className="border-t border-black/5 px-8 py-4 dark:border-white/10">
        <Form method="post" action={path.to.logout}>
          <p className="text-center text-xs text-muted-foreground">
            <Trans>Not you?</Trans>{" "}
            <button
              type="submit"
              className="font-medium text-foreground hover:underline"
            >
              <Trans>Sign Out</Trans>
            </button>
          </p>
        </Form>
      </div>
    </div>
  );
}
