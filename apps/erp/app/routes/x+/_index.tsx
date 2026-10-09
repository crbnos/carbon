// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCompanyTimeZone } from "@carbon/database";
import { CONTROLLED_ENVIRONMENT, getAppUrl } from "@carbon/env";
import {
  gatesDone,
  labelForTier,
  nextAction,
  type Signals,
  SPINE,
  spineForTier,
  stateMap
} from "@carbon/onboarding";
import { OnboardingHubSummary } from "@carbon/onboarding/ui";
import {
  Button,
  Card,
  CardContent,
  cn,
  IconButton,
  PrefetchLink,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
  useOperatingSystem
} from "@carbon/react";
import { datetime, formatRelativeTime } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import * as cookie from "cookie";
import type { ComponentProps, ReactNode } from "react";
import { useCallback, useState } from "react";
import type { IconType } from "react-icons";
import {
  LuChevronDown,
  LuCirclePlus,
  LuFileText,
  LuRocket,
  LuX
} from "react-icons/lu";
import { RxMagnifyingGlass } from "react-icons/rx";
import type { LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import {
  ClaudeIcon,
  CodexIcon,
  CursorIcon,
  OpenCodeIcon
} from "~/components/AgentToolIcons";
import { Greeting } from "~/components/Greeting";
import CreateMenu from "~/components/Layout/Topbar/CreateMenu";
import { ModuleCard } from "~/components/ModuleCard";
import {
  useAllModules,
  useModules,
  usePermissions,
  useRecentlyViewed,
  useUser
} from "~/hooks";
import { useHubDismissed } from "~/hooks/useHubDismissed";
import {
  ImplementationData,
  type ImplementationHubData
} from "~/hooks/useImplementationNavItem";
import type { RecentDocument } from "~/hooks/useRecentlyViewed";
import { useUIStore } from "~/stores/ui";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";

// App-wide dismissal of the onboard-agent badge (not company-scoped): a plain
// cookie so the loader can read it server-side and SSR renders the final state.
const AGENT_WIDGET_COOKIE = "onboardAgentDismissed";

// The home page is always accessible. When a hub is active (enrolled and not yet
// finished) it surfaces as a primary-nav item (`getImplementationNavItem`) and a
// summary card below — it never replaces the home page for anyone.
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  // Compute the greeting on the server so SSR and hydration render the SAME
  // line — no client-side randomness, so no flash on refresh. `pick` is the
  // minute-of-day in the company timezone: deterministic within a minute, so a
  // refresh keeps the same greeting, but it rotates each minute for variety.
  const tz = await getCompanyTimeZone(client, companyId);
  const nowZoned = datetime.now(tz);
  const greeting = {
    hour: nowZoned.hour,
    pick: nowZoned.hour * 60 + nowZoned.minute
  };

  // App-wide (not company-scoped) dismissal of the onboard-agent badge, read
  // server-side so SSR already knows to hide it — no flash of the badge either.
  const cookies = cookie.parse(request.headers.get("Cookie") ?? "");
  const agentDismissed = cookies[AGENT_WIDGET_COOKIE] === "1";

  return { greeting, agentDismissed };
}

const NO_SIGNALS: Signals = {
  hasItems: false,
  hasMakeMethod: false,
  hasJob: false,
  hasSalesOrder: false,
  hasTrackedEntity: false
};

function ImplementationSummary({ data }: { data: ImplementationHubData }) {
  const { i18n } = useLingui();
  const { company } = useUser();
  const [dismissed, dismiss] = useHubDismissed(company.id);

  const hub = data.implementationHub;
  // Shown only to enrolled companies — a hub row exists once the company
  // enrolls itself (self-serve from the home page card below).
  if (!hub || hub.status === "complete" || hub.status === "archived") {
    return null;
  }
  const map = stateMap(data.implementationCheckStates);
  const signals = data.implementationSignals ?? NO_SIGNALS;
  const spine = spineForTier(SPINE, hub.tier);
  const done = gatesDone(spine, map, signals);
  const total = spine.length;
  // Auto-hide once everything's done, or once the user dismissed it.
  if ((data.ready && done === total) || dismissed) return null;

  const next = nextAction(spine, map, signals);
  return (
    <OnboardingHubSummary
      label={i18n._(labelForTier(hub.tier))}
      done={done}
      total={total}
      pending={!data.ready}
      nextLabel={next?.title ? i18n._(next.title) : undefined}
      onDismiss={dismiss}
      action={
        <Button asChild>
          <PrefetchLink to={path.to.getStarted}>Open</PrefetchLink>
        </Button>
      }
    />
  );
}

export default function AppIndexRoute() {
  const { greeting, agentDismissed } = useLoaderData<typeof loader>();
  const modules = useModules();
  const permissions = usePermissions();
  const enrollFetcher = useFetcher();
  // Self-serve: anyone who can update company settings can enroll their
  // company — no Carbon staff required.
  const canEnroll = permissions.can("update", "settings");

  return (
    <div className="relative w-full h-full overflow-hidden">
      <div className="relative z-10 w-full h-full overflow-y-auto">
        <div className="max-w-7xl mx-auto p-8 max-md:p-4">
          <div className="mb-8">
            {!CONTROLLED_ENVIRONMENT && (
              <OnboardAgentWidget dismissed={agentDismissed} />
            )}
            <Greeting
              hour={greeting.hour}
              pick={greeting.pick}
              className="mt-6 mx-auto max-w-[30ch] text-center font-medium max-md:mt-0"
            />
            <div className="mt-8 flex items-center gap-3">
              <SearchBar />
              {/* Phones create from the Create tab. */}
              <div className="contents max-md:hidden">
                <CreateMenu
                  trigger={
                    <Button
                      size="lg"
                      variant="outline"
                      leftIcon={<LuCirclePlus />}
                      rightIcon={<LuChevronDown />}
                      className="shrink-0 h-11"
                    >
                      <Trans>New</Trans>
                    </Button>
                  }
                />
              </div>
            </div>
          </div>
          <ImplementationData>
            {(data) => <ImplementationSummary data={data} />}
          </ImplementationData>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            <div className="lg:col-span-1 order-last lg:order-first">
              {canEnroll ? (
                <ImplementationData>
                  {(data) =>
                    data.implementationHub ? null : (
                      <enrollFetcher.Form
                        method="post"
                        action={path.to.getStartedEnroll}
                        className="mb-6"
                      >
                        <SectionLabel>
                          <Trans>Implementation Hub</Trans>
                        </SectionLabel>
                        <Card className="shadow-none">
                          <CardContent>
                            <p className="text-sm text-muted-foreground text-pretty">
                              <Trans>
                                Set up your company with a step-by-step
                                implementation plan covering setup, data,
                                training, and go-live.
                              </Trans>
                            </p>
                            <div>
                              <Button
                                className="mt-4"
                                type="submit"
                                rightIcon={<LuRocket />}
                                isLoading={enrollFetcher.state !== "idle"}
                                isDisabled={enrollFetcher.state !== "idle"}
                              >
                                <Trans>Enroll</Trans>
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      </enrollFetcher.Form>
                    )
                  }
                </ImplementationData>
              ) : null}
              <RecentlyViewed />
            </div>
            <div className="lg:col-span-2">
              <SectionLabel>
                <Trans>Modules</Trans>
              </SectionLabel>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-md:grid-cols-3 max-md:gap-3">
                {modules
                  .filter((mod) => mod.key !== "settings")
                  .map((module) => (
                    <ModuleCard key={module.key} module={module} />
                  ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const SectionLabel = ({ children }: ComponentProps<"h2">) => (
  <h2 className="text-base font-medium tracking-tight mb-3">{children}</h2>
);

function SearchBar() {
  const { t } = useLingui();
  const { platform } = useOperatingSystem();
  const openSearchModal = useUIStore((s) => s.openSearchModal);
  const modifierKey = platform === "mac" ? "⌘" : "Ctrl";
  return (
    // Single-border button matching the module cards' rounded-lg. Height matches
    // the size="lg" "Add New" button (h-11).
    <button
      type="button"
      onClick={openSearchModal}
      className="group flex flex-1 items-center gap-2 h-11 px-3 rounded-lg border border-border bg-muted/20 text-muted-foreground hover:border-foreground/20 transition-colors active:scale-[0.995]"
    >
      <RxMagnifyingGlass className="w-4 h-4 shrink-0" />
      <span className="text-base truncate">{t`Search`}</span>
      <div className="ml-auto flex items-center gap-1 max-md:hidden">
        <KeyCap>{modifierKey}</KeyCap>
        <KeyCap>K</KeyCap>
      </div>
    </button>
  );
}

const KeyCap = ({ children }: { children: ReactNode }) => (
  <kbd
    className={cn(
      "grid place-content-center min-w-6 h-6 px-1.5 rounded-md",
      "border border-border bg-muted/60 text-xs font-medium text-muted-foreground",
      "group-hover:text-foreground/80 transition-colors"
    )}
  >
    {children}
  </kbd>
);

// The AI coding tools the setup prompt covers (Claude, Codex, Cursor, OpenCode).
// Only Claude carries its brand color; the rest inherit the pill's text color via
// `currentColor`. Purely decorative — the copied prompt works with any MCP client.
const AGENT_TOOL_ICONS: {
  Icon: (props: ComponentProps<"svg">) => JSX.Element;
  className: string;
}[] = [
  { Icon: ClaudeIcon, className: "h-4 w-4" },
  { Icon: CodexIcon, className: "h-4 w-4" },
  { Icon: CursorIcon, className: "h-4 w-4" },
  { Icon: OpenCodeIcon, className: "h-4 w-auto" }
];

// The clipboard payload: a short prompt the user pastes into their AI tool, which
// points the agent at this instance's public setup doc (served by
// `agent-setup.prompt[.]md.tsx`). `getAppUrl()` is this deployment's own origin,
// so a self-hosted / ITAR instance links to itself.
function buildAgentSetupMessage(origin: string) {
  return `Onboard yourself to my Carbon ERP instance over MCP.

Read the setup instructions at ${origin}/agent-setup/prompt.md and follow them to connect your MCP client to ${origin}/api/mcp, then verify the connection works.`;
}

function OnboardAgentWidget({ dismissed: initial }: { dismissed: boolean }) {
  const { t } = useLingui();
  // Seed from the server-read cookie so SSR and the first client render agree
  // (no flash of the badge). Dismiss writes the same app-wide cookie and hides
  // it locally, so the next server render already knows.
  const [dismissed, setDismissed] = useState(initial);

  if (dismissed) return null;

  const handleCopy = () => {
    copyToClipboard(buildAgentSetupMessage(getAppUrl()), () => {
      toast.success(t`Copied setup prompt to your clipboard`);
    });
  };

  const dismiss = () => {
    document.cookie = cookie.serialize(AGENT_WIDGET_COOKIE, "1", {
      path: "/",
      maxAge: 60 * 60 * 24 * 365
    });
    setDismissed(true);
  };

  return (
    // No gap: the pill stays perfectly centered because the ✕ slot collapses to
    // zero width when idle. On hover (or keyboard focus) the slot animates open,
    // sliding the pill left to make room — the movement IS the reveal.
    <div className="group flex items-center justify-center max-md:mb-6">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-3 h-9 max-md:h-11 pl-4 pr-4 max-w-full rounded-full border border-border bg-muted/30 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors active:scale-[0.98]"
          >
            {/* min-w-0 + overflow-hidden lets the label clip instead of
                wrapping to a second line on narrow screens — the icons keep
                their width and the text runs out of sight behind them. */}
            <span className="min-w-0 overflow-hidden whitespace-nowrap">
              <Trans>Onboard your agent to Carbon</Trans>
            </span>
            <span className="flex items-center gap-2 text-foreground">
              {AGENT_TOOL_ICONS.map(({ Icon, className }, i) => (
                <Icon key={i} className={cn("shrink-0", className)} />
              ))}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <Trans>Copies a setup prompt for your AI coding tool</Trans>
        </TooltipContent>
      </Tooltip>
      <div className="w-0 overflow-hidden transition-[width] duration-200 ease-out group-hover:w-8 group-focus-within:w-8 max-md:w-8">
        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton
              aria-label={t`Don't show this again`}
              icon={<LuX />}
              variant="ghost"
              size="sm"
              isRound
              onClick={dismiss}
              className="ml-2 text-muted-foreground rounded-full md:opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100"
            />
          </TooltipTrigger>
          <TooltipContent>
            <Trans>Don't show this again</Trans>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

function RecentlyViewed() {
  const { company } = useUser();
  const { documents, remove, loading } = useRecentlyViewed(company.id);
  const modules = useAllModules();

  // Resolve a document's `handle.module` to its module icon straight from the
  // `useModules` registry — the single source of truth for module icons. Match
  // on the module key OR the second segment of its URL, since item detail pages
  // declare `module: "items"` while the registry keys that module `parts`
  // (its URL is `/x/items/parts`). Nothing to keep in sync.
  const iconForModule = useCallback(
    (moduleKey: string): IconType => {
      const module = modules.find(
        (m) => m.key === moduleKey || m.to.split("/")[2] === moduleKey
      );
      return module?.icon ?? LuFileText;
    },
    [modules]
  );

  return (
    <>
      <SectionLabel>
        <Trans>Recent</Trans>
      </SectionLabel>
      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <RecentDocumentSkeleton key={i} />
          ))}
        </div>
      ) : documents.length === 0 ? (
        <Card className="shadow-none">
          <CardContent className="py-8 text-center">
            <p className="text-sm text-muted-foreground text-pretty">
              <Trans>
                Documents you open will show up here for quick access.
              </Trans>
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {documents.map((doc) => (
            <RecentDocumentRow
              key={doc.url}
              doc={doc}
              icon={iconForModule(doc.module)}
              onRemove={() => remove(doc.url)}
            />
          ))}
        </div>
      )}
    </>
  );
}

// Mirrors RecentDocumentRow's wrapper (p-3, gap-3, rounded-lg border) and its
// w-9/h-9 rounded-lg icon so the skeleton has the exact same height and
// roundness as a real row.
const RecentDocumentSkeleton = () => (
  <div className="flex bg-muted/30 items-center gap-3 p-3 rounded-lg border border-border">
    <Skeleton className="shrink-0 w-9 h-9 rounded-lg" />
    <div className="flex-1 min-w-0 flex flex-col gap-1.5">
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-3 w-1/3" />
    </div>
  </div>
);

const RecentDocumentRow = ({
  doc,
  icon: Icon,
  onRemove
}: {
  doc: RecentDocument;
  icon: IconType;
  onRemove: () => void;
}) => {
  const { t } = useLingui();
  const { locale } = useLocale();
  return (
    <div className="relative group">
      <PrefetchLink
        to={doc.url}
        className="flex items-center gap-3 p-3 bg-muted/20 rounded-lg border border-border hover:border-foreground/20 transition-colors"
      >
        <div className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center bg-muted">
          <Icon className="w-4 h-4 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium tracking-tight truncate">
            {doc.title}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {doc.typeLabel ? `${doc.typeLabel} · ` : ""}
            {formatRelativeTime(doc.viewedAt, locale)}
          </div>
        </div>
      </PrefetchLink>
      <IconButton
        aria-label={t`Remove`}
        icon={<LuX />}
        variant="ghost"
        size="sm"
        onClick={onRemove}
        className="absolute right-2 top-1/2 -translate-y-1/2 md:opacity-0 group-hover:opacity-100 transition-opacity"
      />
    </div>
  );
};
