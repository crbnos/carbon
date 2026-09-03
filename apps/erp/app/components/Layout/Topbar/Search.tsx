import type { ShortcutDefinition } from "@carbon/react";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  cn,
  Modal,
  ModalContent,
  useDebounce,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import idb from "localforage";
import { nanoid } from "nanoid";
import { useEffect, useRef, useState } from "react";
import type { IconType } from "react-icons";
import {
  LuChevronRight,
  LuCirclePlay,
  LuClock,
  LuCornerDownLeft,
  LuFileCheck,
  LuPackageSearch,
  LuShoppingCart,
  LuSquareUser,
  LuUser,
  LuX
} from "react-icons/lu";
import { PiShareNetworkFill } from "react-icons/pi";
import {
  RiProgress2Line,
  RiProgress4Line,
  RiProgress8Line
} from "react-icons/ri";
import { RxMagnifyingGlass } from "react-icons/rx";
import { useFetcher, useNavigate } from "react-router";
import { MethodItemTypeIcon } from "~/components/Icons";
import { getEntityTypeConfig } from "~/components/Layout/Topbar/Search/config";
import { SearchEmptyState } from "~/components/Layout/Topbar/Search/SearchEmptyState";
import { SearchFilterChips } from "~/components/Layout/Topbar/Search/SearchFilterChips";
import type { EntityTypeFilter } from "~/components/Layout/Topbar/Search/types";
import { useModules, useSettingsModule, useUser } from "~/hooks";
import useAccountSubmodules from "~/modules/account/ui/useAccountSubmodules";
import useAccountingSubmodules from "~/modules/accounting/ui/useAccountingSubmodules";
import useDocumentsSubmodules from "~/modules/documents/ui/useDocumentsSubmodules";
import useInventorySubmodules from "~/modules/inventory/ui/useInventorySubmodules";
import useInvoicingSubmodules from "~/modules/invoicing/ui/useInvoicingSubmodules";
import useItemsSubmodules from "~/modules/items/ui/useItemsSubmodules";
import usePeopleSubmodules from "~/modules/people/ui/usePeopleSubmodules";
import useProductionSubmodules from "~/modules/production/ui/useProductionSubmodules";
import usePurchasingSubmodules from "~/modules/purchasing/ui/usePurchasingSubmodules";
import useQualitySubmodules from "~/modules/quality/ui/useQualitySubmodules";
import useResourcesSubmodules from "~/modules/resources/ui/useResourcesSubmodules";
import useSalesSubmodules from "~/modules/sales/ui/useSalesSubmodules";
import useSettingsSubmodules from "~/modules/settings/ui/useSettingsSubmodules";
import useUsersSubmodules from "~/modules/users/ui/useUsersSubmodules";
import useWorkflowsSubmodules from "~/modules/workflows/ui/useWorkflowsSubmodules";
import type { SearchResponse } from "~/routes/api+/search";
import { useUIStore } from "~/stores/ui";
import type { Authenticated, Route } from "~/types";

type RecentSearch = Route & {
  entityType?: string;
  module?: string;
  description?: string;
};

export const searchShortcut: ShortcutDefinition = {
  key: "K",
  modifiers: ["mod"]
};

export const SearchModal = () => {
  const { t } = useLingui();
  const navigate = useNavigate();
  const fetcher = useFetcher<SearchResponse>();
  const { isSearchModalOpen, closeSearchModal } = useUIStore();
  const { company } = useUser();
  const storageKey = `recentSearches_${company.id}`;

  const [input, setInput] = useState("");
  const [typeFilter, setTypeFilter] = useState<EntityTypeFilter>("all");
  const typeFilterRef = useRef<EntityTypeFilter>(typeFilter);
  typeFilterRef.current = typeFilter;
  const [isDebouncing, setIsDebouncing] = useState(false);

  const buildSearchUrl = (q: string, type: EntityTypeFilter) => {
    const params = new URLSearchParams({ q });
    if (type !== "all") {
      params.set("type", type);
    }
    return `/api/search?${params.toString()}`;
  };

  // Always read the latest type filter so a pending debounce after chip change
  // does not re-fetch with a stale type.
  const debounceSearch = useDebounce((q: string) => {
    if (q && q.length >= 2) {
      fetcher.load(buildSearchUrl(q, typeFilterRef.current));
    }
    setIsDebouncing(false);
  }, 500);

  useEffect(() => {
    if (isSearchModalOpen) {
      setInput("");
      setTypeFilter("all");
      typeFilterRef.current = "all";
    }
  }, [isSearchModalOpen]);

  const navItems = useNavigationItems();
  const modules = useModules();

  const getModuleIcon = (moduleName: string) => {
    const module = modules.find(
      (m) => m.name.toLowerCase() === moduleName.toLowerCase()
    );
    return module?.icon;
  };

  const [recentResults, setRecentResults] = useState<RecentSearch[]>([]);
  useEffect(() => {
    const loadRecentSearches = async () => {
      const recentResultsFromStorage =
        await idb.getItem<RecentSearch[]>(storageKey);
      if (recentResultsFromStorage) {
        setRecentResults(recentResultsFromStorage);
      } else {
        setRecentResults([]);
      }
    };
    loadRecentSearches();
  }, [storageKey]);

  const recentPaths = new Set(recentResults.map((r) => r.to));
  const searchResults = input.length >= 2 ? (fetcher.data?.results ?? []) : [];
  const loading = fetcher.state === "loading";
  const isEntityTypeFiltered = typeFilter !== "all";

  // cmdk's built-in filter/sort is disabled (`shouldFilter={false}`) so that we
  // control ordering deterministically — navigation always renders before the
  // search-index results. That means we filter the static lists ourselves here.
  const normalizedInput = input.toLowerCase().trim();
  const matchesInput = (text: string) =>
    normalizedInput.length === 0 ||
    text.toLowerCase().includes(normalizedInput);

  // When a type chip is active, only show recents that match that entity type
  const visibleRecentResults = (
    isEntityTypeFiltered
      ? recentResults.filter((r) => r.entityType === typeFilter)
      : recentResults
  ).filter((r) => matchesInput(r.name));

  // Flat module › submodule navigation. Hidden when filtering by entity type
  // (entity results only), and links already surfaced as recents are dropped.
  const visibleNavItems = isEntityTypeFiltered
    ? []
    : navItems.filter(
        (item) =>
          !recentPaths.has(item.to) &&
          matchesInput(`${item.module} ${item.name}`)
      );

  const hasAnyResults =
    searchResults.length > 0 ||
    visibleNavItems.length > 0 ||
    visibleRecentResults.length > 0;

  const onInputChange = (value: string) => {
    setInput(value);
    if (value && value.length >= 2) {
      setIsDebouncing(true);
    }
    debounceSearch(value);
  };

  const onTypeFilterChange = (filter: EntityTypeFilter) => {
    setTypeFilter(filter);
    typeFilterRef.current = filter;
    // Re-fetch immediately so chip selection feels responsive
    if (input && input.length >= 2) {
      setIsDebouncing(false);
      fetcher.load(buildSearchUrl(input, filter));
    }
  };

  const onSelect = async (
    route: Route,
    entityType?: string,
    module?: string,
    description?: string
  ) => {
    const { to, name } = route;
    navigate(route.to);
    closeSearchModal();
    const newRecentSearches: RecentSearch[] = [
      { to, name, entityType, module, description },
      ...((await idb.getItem<RecentSearch[]>(storageKey))?.filter(
        (item) => item.to !== to
      ) ?? [])
    ].slice(0, 5);

    setRecentResults(newRecentSearches);
    idb.setItem(storageKey, newRecentSearches);
  };

  const removeRecentSearch = async (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const existingRecent =
      (await idb.getItem<RecentSearch[]>(storageKey)) ?? [];
    const updated = existingRecent.filter((item) => item.to !== path);

    setRecentResults(updated);
    await idb.setItem(storageKey, updated);
  };

  return (
    <Modal
      open={isSearchModalOpen}
      onOpenChange={(open) => {
        setInput("");
        setTypeFilter("all");
        typeFilterRef.current = "all";
        if (!open) closeSearchModal();
      }}
    >
      <ModalContent
        className="rounded-lg p-0 h-[520px] max-w-2xl overflow-hidden dark:shadow-button"
        withCloseButton={false}
      >
        <Command shouldFilter={false} className="h-full flex flex-col">
          {/* Search Input */}

          <CommandInput
            placeholder={t`Search across your workspace...`}
            value={input}
            onValueChange={onInputChange}
            className="h-14 text-base"
          />

          <SearchFilterChips
            selectedFilter={typeFilter}
            onFilterChange={onTypeFilterChange}
          />

          {/* Results */}
          <CommandList className="flex-1 max-h-none overflow-y-auto px-2 py-2">
            {loading || isDebouncing ? (
              <SearchEmptyState type="loading" />
            ) : !hasAnyResults ? (
              <SearchEmptyState type="no-results" query={input} />
            ) : (
              <>
                {/* Recent Searches */}
                {visibleRecentResults.length > 0 && (
                  <>
                    <CommandGroup
                      heading={
                        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          <LuClock className="w-3 h-3" />
                          <Trans>Recent</Trans>
                        </span>
                      }
                      key="recent"
                    >
                      {visibleRecentResults.map((result, index) => {
                        const ModuleIcon = result.module
                          ? getModuleIcon(result.module)
                          : undefined;
                        return (
                          <CommandItem
                            key={`${result.to}-${nanoid()}-${index}`}
                            onSelect={() =>
                              onSelect(
                                result,
                                result.entityType,
                                result.module,
                                result.description
                              )
                            }
                            value={`:${result.to}`}
                            className="flex items-center gap-3 px-3 py-2.5 rounded-lg group"
                          >
                            <ResultIconContainer entityType={result.entityType}>
                              {result.entityType ? (
                                <ResultIcon entityType={result.entityType} />
                              ) : ModuleIcon ? (
                                <ModuleIcon className="w-4 h-4 text-muted-foreground" />
                              ) : (
                                <RxMagnifyingGlass className="w-4 h-4 text-muted-foreground" />
                              )}
                            </ResultIconContainer>
                            <VStack spacing={0} className="flex-1 min-w-0">
                              <span className="font-medium truncate">
                                {result.name}
                              </span>
                              {result.description && (
                                <span className="text-sm text-muted-foreground truncate">
                                  {result.description}
                                </span>
                              )}
                            </VStack>
                            <button
                              type="button"
                              onClick={(e) => removeRecentSearch(result.to, e)}
                              className="flex-shrink-0 p-1 rounded hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <LuX className="w-4 h-4 text-muted-foreground" />
                            </button>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                    <CommandSeparator className="my-2" />
                  </>
                )}

                {/* Module › Submodule navigation. A flat list, always rendered
                    before the search-index results. Hidden when filtering by
                    entity type. */}
                {visibleNavItems.length > 0 && (
                  <>
                    <CommandGroup
                      heading={
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          <Trans>Navigation</Trans>
                        </span>
                      }
                      key="navigation"
                    >
                      {visibleNavItems.map((item, index) => (
                        <CommandItem
                          key={`${item.to}-${index}`}
                          onSelect={() =>
                            onSelect(
                              { to: item.to, name: item.name },
                              undefined,
                              item.module
                            )
                          }
                          value={`nav:${item.to}:${index}`}
                          className="flex items-center gap-3 px-3 py-2 rounded-lg group"
                        >
                          <div className="flex-shrink-0 w-7 h-7 rounded-md bg-muted/50 flex items-center justify-center text-muted-foreground [&>svg]:w-4 [&>svg]:h-4">
                            {item.iconElement ? (
                              item.iconElement
                            ) : item.moduleIcon ? (
                              <item.moduleIcon className="w-4 h-4" />
                            ) : null}
                          </div>
                          <span className="flex flex-1 items-center gap-1.5 min-w-0 text-sm">
                            <span className="whitespace-nowrap text-muted-foreground">
                              {item.module}
                            </span>
                            <LuChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground/40" />
                            <span className="truncate font-medium text-foreground">
                              {item.name}
                            </span>
                          </span>
                          <LuCornerDownLeft className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </CommandItem>
                      ))}
                    </CommandGroup>
                    {searchResults.length > 0 && (
                      <CommandSeparator className="my-2" />
                    )}
                  </>
                )}

                {/* Search Results (from the per-company search index) */}
                {searchResults.length > 0 && (
                  <CommandGroup
                    heading={
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        <Trans>Results</Trans>
                      </span>
                    }
                    key="search"
                  >
                    {searchResults.map((result) => (
                      <CommandItem
                        key={`${result.id}-${nanoid()}`}
                        value={`${input}${result.id}`}
                        onSelect={() =>
                          onSelect(
                            {
                              to: result.link,
                              name: result.title
                            },
                            result.entityType,
                            undefined,
                            result.description!
                          )
                        }
                        className="flex items-center gap-3 px-3 py-3 rounded-lg group"
                      >
                        <ResultIconContainer entityType={result.entityType}>
                          <ResultIcon entityType={result.entityType} />
                        </ResultIconContainer>
                        <VStack spacing={0} className="flex-1 min-w-0">
                          <span className="font-medium text-foreground truncate">
                            {result.title}
                          </span>
                          {result.description && (
                            <span className="text-sm text-muted-foreground truncate">
                              {result.description}
                            </span>
                          )}
                        </VStack>
                        <LuChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
              </>
            )}
          </CommandList>

          {/* Footer */}
          <div className="border-t border-border px-4 py-2 flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono text-[10px]">
                  Up/Down
                </kbd>
                <Trans>Navigate</Trans>
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono text-[10px]">
                  Enter
                </kbd>
                <Trans>Select</Trans>
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono text-[10px]">
                  Esc
                </kbd>
                <Trans>Close</Trans>
              </span>
            </div>
          </div>
        </Command>
      </ModalContent>
    </Modal>
  );
};

function ResultIconContainer({
  entityType,
  children
}: {
  entityType?: string;
  children: React.ReactNode;
}) {
  const config = entityType ? getEntityTypeConfig(entityType) : null;
  const hasTint = Boolean(config?.bgColor);

  return (
    <div
      className={cn(
        "flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center",
        hasTint ? config?.bgColor : "bg-muted"
      )}
    >
      {children}
    </div>
  );
}

function ResultIcon({ entityType }: { entityType: string }) {
  const config = getEntityTypeConfig(entityType);
  const iconClass = cn("w-4 h-4", config.textColor || "text-muted-foreground");

  // Prefer shared entity config icons (issue → LuOctagonAlert, gauge → LuGauge)
  if (config.icon) {
    const Icon = config.icon;
    return <Icon className={iconClass} />;
  }

  // Fallbacks for types without a config icon
  switch (entityType) {
    case "customer":
      return <LuSquareUser className={iconClass} />;
    case "employee":
      return <LuUser className={iconClass} />;
    case "job":
      return <LuCirclePlay className={iconClass} />;
    case "item":
      return <MethodItemTypeIcon type="Part" className={iconClass} />;
    case "purchaseOrder":
      return <LuShoppingCart className={iconClass} />;
    case "salesInvoice":
      return <RiProgress8Line className={iconClass} />;
    case "purchaseInvoice":
      return <LuFileCheck className={iconClass} />;
    case "supplier":
      return <PiShareNetworkFill className={iconClass} />;
    case "quote":
      return <RiProgress4Line className={iconClass} />;
    case "salesRfq":
      return <RiProgress2Line className={iconClass} />;
    case "salesOrder":
      return <RiProgress8Line className={iconClass} />;
    case "supplierQuote":
      return <LuPackageSearch className={iconClass} />;
    default:
      return null;
  }
}

type NavigationItem = {
  /** Parent module display name, e.g. "Accounting" */
  module: string;
  /** Parent module icon (fallback when the submodule has no icon) */
  moduleIcon?: IconType;
  /** Submodule display name, e.g. "Reporting" */
  name: string;
  to: string;
  /** Submodule-specific icon element (rendered directly when present) */
  iconElement?: React.ReactNode;
};

// A flat list of `Module › Submodule` navigation targets for the search palette.
// Ordered by the user's module ordering; each module contributes its submodule
// links in order.
function useNavigationItems(): NavigationItem[] {
  const modules = useModules();
  const settingsModule = useSettingsModule();
  const items = useItemsSubmodules();
  const production = useProductionSubmodules();
  const inventory = useInventorySubmodules();
  const sales = useSalesSubmodules();
  const purchasing = usePurchasingSubmodules();
  const documents = useDocumentsSubmodules();
  const accounting = useAccountingSubmodules();
  const invoicing = useInvoicingSubmodules();
  const users = useUsersSubmodules();
  const settings = useSettingsSubmodules();
  const people = usePeopleSubmodules();
  const quality = useQualitySubmodules();
  const resources = useResourcesSubmodules();
  const account = useAccountSubmodules();
  const workflows = useWorkflowsSubmodules();
  const groupedSubmodules: Record<
    string,
    {
      groups: {
        routes: Authenticated<Route>[];
        name: string;
        icon?: any;
      }[];
    }
  > = {
    items,
    inventory,
    sales,
    purchasing,
    quality,
    accounting,
    invoicing,
    people,
    production,
    resources,
    settings,
    users,
    workflows,
    "my account": account
  };

  const ungroupedSubmodules: Record<string, { links: Route[] }> = {
    documents
  };

  // Settings is pinned out of `useModules()`, but its submodules should still be
  // reachable from search (e.g. "Settings › API Keys"), so append it explicitly.
  const searchableModules = settingsModule
    ? [...modules, settingsModule]
    : modules;

  return searchableModules.reduce<NavigationItem[]>((acc, module) => {
    const moduleName = module.name.toLowerCase();

    if (moduleName in groupedSubmodules) {
      for (const route of groupedSubmodules[moduleName].groups.flatMap(
        (group) => group.routes
      )) {
        acc.push({
          module: module.name,
          moduleIcon: module.icon,
          name: route.name,
          to: route.to,
          iconElement: route.icon
        });
      }
    } else if (moduleName in ungroupedSubmodules) {
      for (const link of ungroupedSubmodules[moduleName].links) {
        acc.push({
          module: module.name,
          moduleIcon: module.icon,
          name: link.name,
          to: link.to
        });
      }
    }

    return acc;
  }, []);
}
