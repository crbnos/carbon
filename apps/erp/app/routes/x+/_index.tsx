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
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ComponentProps } from "react";
import { useMemo } from "react";
import { LuRocket } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Link, redirect, useFetcher } from "react-router";
import { Greeting } from "~/components/Greeting";
import { MeshGradientBackground } from "~/components/MeshGradientBackground";
import { useModules, usePermissions, useUser } from "~/hooks";
import { useHubDismissed } from "~/hooks/useHubDismissed";
import type { Authenticated, NavItem } from "~/types";
import { path } from "~/utils/path";

// While a hub is active (not yet finished) it replaces the home page for
// internal users, who land straight in it until every checkpoint is done.
// Customers keep the normal home page (with the hub summary card) — only the
// auto-redirect is internal-only.
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
  // Shown only to enrolled companies — a hub row exists once the company
  // enrolls itself (self-serve from the home page card below).
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
  const permissions = usePermissions();
  const enrollFetcher = useFetcher();
  // Self-serve: anyone who can update company settings can enroll their
  // company — no Carbon staff required.
  const canEnroll =
    permissions.can("update", "settings") && !layout?.implementationHub;

  return (
    <div className="relative w-full h-full overflow-hidden">
      <MeshGradientBackground darkOnly />
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
            <div className="rounded-2xl ring-2 ring-transparent bg-gradient-to-bl from-card/70 from-50% to-background/70 backdrop-blur-md shadow-button-base p-6 flex items-start gap-4">
              <div className="shrink-0 size-11 rounded-2xl bg-accent flex items-center justify-center text-primary">
                <LuRocket className="text-xl" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xxs uppercase tracking-wide font-medium text-primary">
                  <Trans>Get Started</Trans>
                </div>
                <div className="text-base font-semibold tracking-tight mt-0.5 text-balance">
                  <Trans>Enroll this company in the Implementation Hub</Trans>
                </div>
                <p className="text-sm text-muted-foreground mt-1 text-pretty">
                  <Trans>
                    Set up your company with a step-by-step implementation plan
                    covering setup, data, training, and go-live.
                  </Trans>
                </p>
                <Button
                  className="mt-4"
                  type="submit"
                  isLoading={enrollFetcher.state !== "idle"}
                  isDisabled={enrollFetcher.state !== "idle"}
                >
                  <Trans>Enroll</Trans>
                </Button>
              </div>
            </div>
          </enrollFetcher.Form>
        ) : null}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
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
    prefetch={module.external ? "none" : "intent"}
    {...(module.external
      ? { target: "_blank", rel: "noopener noreferrer" }
      : {})}
    className="flex items-center gap-4 p-4 bg-card/70 backdrop-blur-md rounded-lg border border-border group hover:bg-accent/40 hover:border-foreground/20 cursor-pointer transition-colors duration-200"
  >
    <div className="shrink-0 p-2.5 rounded-lg border border-border group-hover:border-foreground/20 transition-colors">
      <module.icon className="text-xl" />
    </div>
    <span className="text-sm py-1 px-4 border border-border rounded-full group-hover:bg-background font-medium tracking-tight transition-colors">
      {module.name}
    </span>
  </Link>
);
