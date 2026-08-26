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
import type { ShortcutDefinition } from "@carbon/react";
import {
  Button,
  Card,
  CardContent,
  IconButton,
  ShortcutKey,
  useRouteData
} from "@carbon/react";
import { formatRelativeTime, isInternalEmail } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ComponentProps } from "react";
import { useCallback } from "react";
import type { IconType } from "react-icons";
import {
  LuChevronDown,
  LuFileText,
  LuPlus,
  LuRocket,
  LuX
} from "react-icons/lu";
import { RxMagnifyingGlass } from "react-icons/rx";
import type { LoaderFunctionArgs } from "react-router";
import { Link, redirect, useFetcher } from "react-router";
import CreateMenu from "~/components/Layout/Topbar/CreateMenu";
import {
  useAllModules,
  useModules,
  usePermissions,
  useRecentlyViewed,
  useUser
} from "~/hooks";
import { useHubDismissed } from "~/hooks/useHubDismissed";
import type { RecentDocument } from "~/hooks/useRecentlyViewed";
import { useUIStore } from "~/stores/ui";
import type { Authenticated, NavItem } from "~/types";
import { path } from "~/utils/path";

const searchShortcut: ShortcutDefinition = { key: "K", modifiers: ["mod"] };

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
      <div className="relative z-10 p-8 w-full h-full overflow-y-auto">
        <div className="flex items-center gap-3 mb-8">
          <SearchBar />
          <CreateMenu
            trigger={
              <Button
                size="md"
                variant="secondary"
                leftIcon={<LuPlus />}
                rightIcon={<LuChevronDown />}
                className="shrink-0"
              >
                <Trans>Add New</Trans>
              </Button>
            }
          />
        </div>
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
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <div className="lg:col-span-1 order-last lg:order-first">
            {canEnroll ? (
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
                        Set up your company with a step-by-step implementation
                        plan covering setup, data, training, and go-live.
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
            ) : null}
            <RecentlyViewed />
          </div>
          <div className="lg:col-span-2">
            <SectionLabel>
              <Trans>Modules</Trans>
            </SectionLabel>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
  );
}

const SectionLabel = ({ children }: ComponentProps<"h2">) => (
  <h2 className="text-base font-medium tracking-tight mb-3">{children}</h2>
);

function SearchBar() {
  const { t } = useLingui();
  const openSearchModal = useUIStore((s) => s.openSearchModal);
  return (
    <button
      type="button"
      onClick={openSearchModal}
      className="flex flex-1 items-center gap-2 h-9 px-3 rounded-md border border-border bg-card/70 backdrop-blur-md text-muted-foreground hover:border-foreground/20 transition-colors active:scale-[0.99]"
    >
      <RxMagnifyingGlass className="w-4 h-4 shrink-0" />
      <span className="text-sm truncate">
        {t`Search across your workspace...`}
      </span>
      <ShortcutKey
        shortcut={searchShortcut}
        variant="small"
        className="ml-auto"
      />
    </button>
  );
}

function RecentlyViewed() {
  const { company } = useUser();
  const { documents, remove } = useRecentlyViewed(company.id);
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
      {documents.length === 0 ? (
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
      <Link
        to={doc.url}
        prefetch="intent"
        className="flex items-center gap-3 p-3 bg-card/70 backdrop-blur-md rounded-lg border border-border hover:bg-card/60 hover:border-foreground/20 transition-colors"
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
      </Link>
      <IconButton
        aria-label={t`Remove`}
        icon={<LuX />}
        variant="ghost"
        size="sm"
        onClick={onRemove}
        className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
      />
    </div>
  );
};

const ModuleCard = ({ module }: { module: Authenticated<NavItem> }) => (
  <Link
    to={module.to}
    prefetch={module.external ? "none" : "intent"}
    {...(module.external
      ? { target: "_blank", rel: "noopener noreferrer" }
      : {})}
    className="flex items-center gap-4 p-4 bg-card/70 backdrop-blur-md rounded-lg border border-border group hover:bg-card/60 hover:border-foreground/20 cursor-pointer transition-colors duration-200"
  >
    <div className="shrink-0 p-2.5 rounded-lg border border-border group-hover:border-foreground/20 transition-colors">
      <module.icon className="text-xl" />
    </div>
    <span className="text-sm py-1 px-4 border border-border rounded-full group-hover:bg-background font-medium tracking-tight transition-colors">
      {module.name}
    </span>
  </Link>
);
