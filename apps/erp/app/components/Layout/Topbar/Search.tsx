import type { ShortcutDefinition } from "@carbon/react";
import {
  Button,
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  HStack,
  Modal,
  ModalContent,
  ShortcutKey,
  useDebounce,
  useShortcutKeys,
  VStack
} from "@carbon/react";
import idb from "localforage";
import { nanoid } from "nanoid";
import { memo, useEffect, useState } from "react";
import {
  LuChevronRight,
  LuCirclePlay,
  LuClock,
  LuDraftingCompass,
  LuFileCheck,
  LuPackageSearch,
  LuSearch,
  LuShieldX,
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
import { useModules, useUser } from "~/hooks";
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
import type { SearchResponse } from "~/routes/api+/search";
import { useUIStore } from "~/stores/ui";

import type { Authenticated, Route } from "~/types";
import { SearchEmptyState } from "./Search/SearchEmptyState";

type RecentSearch = Route & {
  entityType?: string;
  module?: string;
  description?: string;
};

const shortcut: ShortcutDefinition = {
  key: "K",
  modifiers: ["mod"]
};

const SearchModal = () => {
  const navigate = useNavigate();
  const fetcher = useFetcher<SearchResponse>();
  const { isSearchModalOpen, closeSearchModal } = useUIStore();
  const { company } = useUser();
  const storageKey = `recentSearches_${company.id}`;

  const [input, setInput] = useState("");
  const [isDebouncing, setIsDebouncing] = useState(false);
  const debounceSearch = useDebounce((q: string) => {
    if (q && q.length >= 2) {
      fetcher.load(`/api/search?q=${encodeURIComponent(q)}`);
    }
    setIsDebouncing(false);
  }, 500);

  useEffect(() => {
    if (isSearchModalOpen) {
      setInput("");
    }
  }, [isSearchModalOpen]);

  const staticResults = useGroupedSubmodules();
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

  // Filter static results based on input for empty state detection
  const normalizedInput = input.toLowerCase().trim();
  const hasMatchingStaticResults =
    normalizedInput.length === 0 ||
    Object.entries(staticResults).some(([module, submodules]) =>
      submodules.some(
        (s) =>
          !recentPaths.has(s.to) &&
          `${module} ${s.name}`.toLowerCase().includes(normalizedInput)
      )
    );
  const hasMatchingRecentResults =
    normalizedInput.length === 0 ||
    recentResults.some((r) => r.name.toLowerCase().includes(normalizedInput));

  const hasAnyResults =
    searchResults.length > 0 ||
    hasMatchingStaticResults ||
    hasMatchingRecentResults;

  const onInputChange = (value: string) => {
    setInput(value);
    if (value && value.length >= 2) {
      setIsDebouncing(true);
    }
    debounceSearch(value);
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
        if (!open) closeSearchModal();
      }}
    >
      <ModalContent
        className="rounded-xl p-0 h-[520px] max-w-2xl overflow-hidden dark:shadow-button"
        withCloseButton={false}
      >
        <Command className="h-full flex flex-col">
          {/* Search Input */}

          <CommandInput
            placeholder="Search across your workspace..."
            value={input}
            onValueChange={onInputChange}
            className="h-14 text-base"
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
                {recentResults.length > 0 && (
                  <>
                    <CommandGroup
                      heading={
                        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          <LuClock className="w-3 h-3" />
                          Recent
                        </span>
                      }
                      key="recent"
                    >
                      {recentResults.map((result, index) => {
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
                            <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                              {result.entityType ? (
                                <ResultIcon entityType={result.entityType} />
                              ) : ModuleIcon ? (
                                <ModuleIcon className="w-4 h-4 text-muted-foreground" />
                              ) : (
                                <RxMagnifyingGlass className="w-4 h-4 text-muted-foreground" />
                              )}
                            </div>
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

                {/* Search Results */}
                {searchResults.length > 0 && (
                  <CommandGroup
                    heading={
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Results
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
                        <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                          <ResultIcon entityType={result.entityType} />
                        </div>
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

                {/* Module Navigation */}
                {Object.entries(staticResults).map(([module, submodules]) => {
                  const filteredSubmodules = submodules.filter(
                    (s) => !recentPaths.has(s.to)
                  );
                  if (filteredSubmodules.length === 0) return null;
                  return (
                    <div key={`static-${module}`}>
                      <CommandGroup
                        heading={
                          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            {module}
                          </span>
                        }
                      >
                        {filteredSubmodules.map((submodule, index) => {
                          const hasIconElement =
                            "iconElement" in submodule && submodule.iconElement;
                          return (
                            <CommandItem
                              key={`${submodule.to}-${submodule.name}-${index}`}
                              onSelect={() =>
                                onSelect(submodule, undefined, module)
                              }
                              value={`${module} ${submodule.name}`}
                              className="flex items-center gap-3 px-3 py-2 rounded-lg group"
                            >
                              <div className="flex-shrink-0 w-7 h-7 rounded-md bg-muted/50 flex items-center justify-center text-muted-foreground [&>svg]:w-4 [&>svg]:h-4">
                                {hasIconElement ? (
                                  submodule.iconElement
                                ) : submodule.icon ? (
                                  <submodule.icon className="w-4 h-4" />
                                ) : null}
                              </div>
                              <span className="flex-1 text-sm">
                                {submodule.name}
                              </span>
                              <LuChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                      <CommandSeparator className="my-2" />
                    </div>
                  );
                })}
              </>
            )}
          </CommandList>

          {/* Footer */}
          <div className="border-t border-border px-4 py-2 flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono text-[10px]">
                  ↑↓
                </kbd>
                Navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono text-[10px]">
                  ↵
                </kbd>
                Select
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono text-[10px]">
                  esc
                </kbd>
                Close
              </span>
            </div>
          </div>
        </Command>
      </ModalContent>
    </Modal>
  );
};

function ResultIcon({ entityType }: { entityType: string }) {
  const iconClass = "w-4 h-4 text-muted-foreground";
  switch (entityType) {
    case "customer":
      return <LuSquareUser className={iconClass} />;
    case "employee":
      return <LuUser className={iconClass} />;
    case "gauge":
      return <LuDraftingCompass className={iconClass} />;
    case "job":
      return <LuCirclePlay className={iconClass} />;
    case "issue":
      return <LuShieldX className={iconClass} />;
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

const SearchButton = () => {
  const { openSearchModal } = useUIStore();

  useShortcutKeys({
    shortcut: shortcut,
    action: openSearchModal
  });

  return (
    <div>
      <Button
        leftIcon={<LuSearch />}
        variant="secondary"
        className="w-[200px] px-2 hover:scale-100"
        onClick={openSearchModal}
      >
        <HStack className="w-full">
          <div className="flex flex-grow">Search</div>
          <ShortcutKey
            variant="small"
            shortcut={shortcut}
            className="hidden sm:grid"
          />
        </HStack>
      </Button>
      <SearchModal />
    </div>
  );
};

function useGroupedSubmodules() {
  const modules = useModules();
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
    users
  };

  const ungroupedSubmodules: Record<string, { links: Route[] }> = {
    documents,
    "my account": account
  };

  const shortcuts = modules.reduce<
    Record<string, (Route & { iconElement?: React.ReactNode })[]>
  >((acc, module) => {
    const moduleName = module.name.toLowerCase();

    if (moduleName in groupedSubmodules) {
      const groups = groupedSubmodules[moduleName].groups;
      acc = {
        ...acc,
        [module.name]: groups.flatMap((group) =>
          group.routes.map((route) => ({
            to: route.to,
            name: route.name,
            icon: module.icon,
            iconElement: route.icon
          }))
        )
      };
    } else if (
      moduleName in ungroupedSubmodules ||
      moduleName === "my account"
    ) {
      acc = {
        ...acc,
        [module.name]: ungroupedSubmodules[moduleName].links.map((link) => ({
          to: link.to,
          name: link.name,
          icon: module.icon
        }))
      };
    }

    return acc;
  }, {});

  return shortcuts;
}

export default memo(SearchButton);
