import { requirePermissions } from "@carbon/auth/auth.server";
import {
  type CheckStateRow,
  gatesDone,
  type HubStatus,
  labelForTier,
  nextAction,
  type Signals,
  SPINE,
  spineForTier,
  stateMap,
  type Tier
} from "@carbon/onboarding";
import {
  detectImplementationSignals,
  getImplementationCheckStates,
  getImplementationHub
} from "@carbon/onboarding/server";
import { OnboardingHubSummary } from "@carbon/onboarding/ui";
import { Button, cn, useRouteData } from "@carbon/react";
import { isInternalEmail } from "@carbon/utils";
import { getLocalTimeZone } from "@internationalized/date";
import { useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ComponentProps } from "react";
import { useMemo } from "react";
import { LuRocket } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Link, redirect, useFetcher } from "react-router";
import { Greeting } from "~/components/Greeting";
import { MeshGradientBackground } from "~/components/MeshGradientBackground";
import { useModules, useUser } from "~/hooks";
import { useFlags } from "~/hooks/useFlags";
import { useHubDismissed } from "~/hooks/useHubDismissed";
import type { Authenticated, NavItem } from "~/types";
import { path } from "~/utils/path";

// The onboarding hub is internal-only and, while it's active (not yet finished),
// it replaces the home page — so an internal user lands straight in it until
// every checkpoint is done.
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, email } = await requirePermissions(request, {});
  if (isInternalEmail(email)) {
    const hub = await getImplementationHub(client, companyId);
    const status = hub.data?.status;
    if (hub.data && status !== "complete" && status !== "archived") {
      const [states, signals] = await Promise.all([
        getImplementationCheckStates(client, companyId),
        detectImplementationSignals(client, companyId)
      ]);
      const spine = spineForTier(SPINE, hub.data.tier);
      const done = gatesDone(spine, stateMap(states.data ?? []), signals);
      if (done < spine.length) throw redirect(path.to.getStarted);
    }
  }
  return null;
}

const NO_SIGNALS: Signals = {
  hasItems: false,
  hasMakeMethod: false,
  hasJob: false,
  hasSalesOrder: false,
  hasTrackedEntity: false
};

function useImplementationSummary() {
  const { i18n } = useLingui();
  const data = useRouteData<{
    implementationHub: { tier: Tier; status: HubStatus } | null;
    implementationCheckStates: CheckStateRow[];
    implementationSignals: Signals | null;
  }>(path.to.authenticatedRoot);
  const { company } = useUser();
  const [dismissed, dismiss] = useHubDismissed(company.id);

  const hub = data?.implementationHub;
  // Shown only to enrolled companies — a hub row exists once Carbon enrolls them.
  if (!hub || hub.status === "complete" || hub.status === "archived") {
    return null;
  }
  const map = stateMap(data?.implementationCheckStates ?? []);
  const signals = data?.implementationSignals ?? NO_SIGNALS;
  const spine = spineForTier(SPINE, hub.tier);
  const done = gatesDone(spine, map, signals);
  const total = spine.length;
  // Auto-hide once everything's done, or once the user dismissed it.
  if (done === total || dismissed) return null;

  const next = nextAction(spine, map, signals);
  return {
    label: i18n._(labelForTier(hub.tier)),
    done,
    total,
    nextLabel: next?.title ? i18n._(next.title) : undefined,
    dismiss
  };
}

export default function AppIndexRoute() {
  const modules = useModules();
  const { locale } = useLocale();
  const date = new Date();

  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "full",
        timeZone: getLocalTimeZone()
      }),
    [locale]
  );
  const implementation = useImplementationSummary();
  const layout = useRouteData<{ implementationHub: unknown | null }>(
    path.to.authenticatedRoot
  );
  const { isInternal } = useFlags();
  const enrollFetcher = useFetcher();
  const canEnroll = isInternal && !layout?.implementationHub;

  return (
    <div className="relative w-full h-full overflow-hidden">
      <MeshGradientBackground />
      <div className="relative z-10 p-8 w-full h-full overflow-y-auto">
        <Greeting size="h3" />
        <Subheading>{formatter.format(date)}</Subheading>
        <Hr />
        {implementation ? (
          <OnboardingHubSummary
            label={implementation.label}
            done={implementation.done}
            total={implementation.total}
            nextLabel={implementation.nextLabel}
            onDismiss={implementation.dismiss}
            action={
              <Button asChild>
                <Link to={path.to.getStarted} prefetch="intent">
                  Open
                </Link>
              </Button>
            }
          />
        ) : null}
        {canEnroll ? (
          <enrollFetcher.Form
            method="post"
            action={path.to.getStartedEnroll}
            className="mb-6"
          >
            <div className="rounded-2xl border border-primary/30 bg-primary/5 shadow-button-base p-6 flex items-start gap-4">
              <div className="shrink-0 size-11 rounded-2xl bg-primary/15 flex items-center justify-center text-primary">
                <LuRocket className="text-xl" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xxs uppercase tracking-wide font-medium text-primary">
                  Carbon-only
                </div>
                <div className="text-base font-semibold tracking-tight mt-0.5 text-balance">
                  Enroll this company in the Implementation Hub
                </div>
                <p className="text-sm text-muted-foreground mt-1 text-pretty">
                  Creates the hub for the current company so you can preview it.
                </p>
                <Button
                  className="mt-4"
                  type="submit"
                  isLoading={enrollFetcher.state !== "idle"}
                  isDisabled={enrollFetcher.state !== "idle"}
                >
                  Enroll
                </Button>
              </div>
            </div>
          </enrollFetcher.Form>
        ) : null}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-6 mb-8">
          {modules
            .filter((mod) => mod.key !== "settings")
            .map((module) => (
              <ModuleCard key={module.key} module={module} />
            ))}
        </div>
      </div>
    </div>
  );
}

const Hr = () => (
  <hr className="h-px my-8 bg-black/10 border-0 dark:bg-white/10" />
);

const Subheading = ({ children, className }: ComponentProps<"p">) => (
  <p className={cn("text-muted-foreground text-base font-light", className)}>
    {children}
  </p>
);

const ModuleCard = ({ module }: { module: Authenticated<NavItem> }) => (
  <Link
    to={module.to}
    prefetch="intent"
    className="aspect-video flex flex-col gap-3 items-center justify-center py-8  shadow-button-base bg-gradient-to-bl from-card/70 from-50% to-background/70 backdrop-blur-md rounded-lg text-center group ring-2 ring-transparent hover:ring-white/10 cursor-pointer hover:scale-105 transition-all duration-300"
  >
    <div className="p-4 rounded-lg border">
      <module.icon className="text-2xl" />
    </div>
    <span className="text-sm py-1 px-4 border border-border rounded-full group-hover:bg-accent font-medium tracking-tight">
      {module.name}
    </span>
  </Link>
);
