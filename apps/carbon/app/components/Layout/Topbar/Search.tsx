import type { Database } from "@carbon/database";
import type { ShortcutDefinition } from "@carbon/react";
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  HStack,
  Modal,
  ModalContent,
  ShortcutKey,
  VStack,
  useDebounce,
  useDisclosure,
  useMount,
  useShortcutKeys,
} from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import idb from "localforage";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useState } from "react";
import { AiOutlinePartition } from "react-icons/ai";
import { BiListCheck } from "react-icons/bi";
import { BsCartDash } from "react-icons/bs";
import { CgProfile } from "react-icons/cg";
import { HiOutlineDocumentDuplicate } from "react-icons/hi";
import { LuSearch, LuUserSquare } from "react-icons/lu";
import { PiShareNetworkFill } from "react-icons/pi";
import {
  RiProgress2Line,
  RiProgress4Line,
  RiProgress8Line,
} from "react-icons/ri";
import { RxMagnifyingGlass } from "react-icons/rx";
import { useModules } from "~/components/Layout/Navigation/useModules";
import { useUser } from "~/hooks";
import { useSupabase } from "~/lib/supabase";
import { useAccountSubmodules } from "~/modules/account";
import { useAccountingSubmodules } from "~/modules/accounting";
import { useDocumentsSubmodules } from "~/modules/documents";
import { useInventorySubmodules } from "~/modules/inventory";
import { useInvoicingSubmodules } from "~/modules/invoicing";
import { useItemsSubmodules } from "~/modules/items";
import { usePeopleSubmodules } from "~/modules/people";
import { usePurchasingSubmodules } from "~/modules/purchasing";
import { useResourcesSubmodules } from "~/modules/resources";
import { useSalesSubmodules } from "~/modules/sales";
import { useSettingsSubmodules } from "~/modules/settings";
import { useUsersSubmodules } from "~/modules/users";
import type { Authenticated, Route } from "~/types";

type SearchResult = {
  id: number;
  name: string;
  entity: Database["public"]["Enums"]["searchEntity"] | null;
  uuid: string | null;
  link: string;
  description: string | null;
};

const shortcut: ShortcutDefinition = {
  key: "K",
  modifiers: ["meta"],
};

const SearchModal = ({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) => {
  const { company } = useUser();
  const { supabase } = useSupabase();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const [input, setInput] = useState("");
  const debounceSearch = useDebounce((q: string) => {
    if (q) {
      getSearchResults(q);
    } else {
      setSearchResults([]);
    }
  }, 500);

  useEffect(() => {
    if (isOpen) {
      setInput("");
    }
  }, [isOpen]);

  const staticResults = useGroupedSubmodules();

  const [recentResults, setRecentResults] = useState<Route[]>([]);
  useMount(async () => {
    const recentResultsFromStorage = await idb.getItem<Route[]>(
      "recentSearches"
    );
    if (recentResultsFromStorage) {
      setRecentResults(recentResultsFromStorage);
    }
  });

  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);

  const getSearchResults = useCallback(
    async (q: string) => {
      if (!supabase || !company.id) return;

      setLoading(true);
      const tokens = q.split(" ");
      const search =
        tokens.length > 1
          ? tokens.map((token) => `"${token}"`).join(" <-> ")
          : q;

      const result = await supabase
        ?.from("search")
        .select()
        .textSearch("fts", `*${search}:*`)
        .eq("companyId", company.id)
        .limit(20);

      if (result?.data) {
        setSearchResults(result.data);
      } else {
        setSearchResults([]);
      }
      setLoading(false);
    },
    [company.id, supabase]
  );

  const onInputChange = (value: string) => {
    setInput(value);
    debounceSearch(value);
  };

  const onSelect = async (route: Route) => {
    const { to, name } = route;
    navigate(route.to);
    onClose();
    const newRecentSearches = [
      { to, name },
      ...((await idb.getItem<Route[]>("recentSearches"))?.filter(
        (item) => item.to !== to
      ) ?? []),
    ].slice(0, 5);

    setRecentResults(newRecentSearches);
    idb.setItem("recentSearches", newRecentSearches);
  };

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        setInput("");
        if (!open) onClose();
      }}
    >
      <ModalContent className="rounded-lg translate-y-0 p-0 h-[343px]">
        <Command className="rounded-lg border shadow-md">
          <CommandInput
            placeholder="Type a command or search..."
            value={input}
            onValueChange={onInputChange}
          />
          <CommandList>
            <CommandEmpty key="empty">
              {loading ? "Loading..." : "No results found."}
            </CommandEmpty>
            {recentResults.length > 0 && (
              <>
                <CommandGroup heading="Recent Searches" key="recent">
                  {recentResults.map((result, index) => (
                    <CommandItem
                      key={`${result.to}-${nanoid()}-${index}`}
                      onSelect={() => onSelect(result)}
                      // append with : so we're not sharing a value with a static result
                      value={`:${result.to}`}
                    >
                      <RxMagnifyingGlass className="w-4 h-4 mr-2" />
                      {result.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
                <CommandSeparator />
              </>
            )}
            {Object.entries(staticResults).map(([module, submodules]) => (
              <>
                <CommandGroup heading={module} key={`static-${module}`}>
                  {submodules.map((submodule, index) => (
                    <CommandItem
                      key={`${submodule.to}-${submodule.name}-${index}`}
                      onSelect={() => onSelect(submodule)}
                      value={`${module} ${submodule.name}`}
                    >
                      {submodule.icon && (
                        <submodule.icon className="w-4 h-4 mr-2" />
                      )}
                      <span>{submodule.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
                <CommandSeparator />
              </>
            ))}
            {searchResults.length > 0 && (
              <CommandGroup heading="Search Results" key="search">
                {searchResults.map((result) => (
                  <CommandItem
                    key={`${result.id}-${nanoid()}`}
                    value={`${input}${result.id}`}
                    onSelect={() =>
                      onSelect({
                        to: result.link,
                        name: result.name,
                      })
                    }
                  >
                    <HStack>
                      <ResultIcon entity={result.entity} />
                      <VStack spacing={0}>
                        <span>{result.name}</span>
                        {result.description && (
                          <span className="text-xs text-muted-foreground">
                            {result.description}
                          </span>
                        )}
                      </VStack>
                    </HStack>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </ModalContent>
    </Modal>
  );
};

function ResultIcon({ entity }: { entity: SearchResult["entity"] | "Module" }) {
  switch (entity) {
    case "Customer":
      return <LuUserSquare className="w-4 h-4 mr-2" />;
    case "Document":
      return <HiOutlineDocumentDuplicate className="w-4 h-4 mr-2" />;
    case "Job":
      return <BiListCheck className="w-4 h-4 mr-2" />;
    case "Part":
      return <AiOutlinePartition className="w-4 h-4 mr-2" />;
    case "Person":
      return <CgProfile className="w-4 h-4 mr-2" />;
    case "Resource":
      return <CgProfile className="w-4 h-4 mr-2" />;
    case "Purchase Order":
      return <BsCartDash className="w-4 h-4 mr-2" />;
    case "Opportunity":
    case "Lead":
    case "Sales RFQ":
      return <RiProgress2Line className="w-4 h-4 mr-2" />;
    case "Quotation":
      return <RiProgress4Line className="w-4 h-4 mr-2" />;
    case "Sales Order":
      return <RiProgress8Line className="w-4 h-4 mr-2" />;
    case "Supplier":
      return <PiShareNetworkFill className="w-4 h-4 mr-2" />;
    default:
      return null;
  }
}

const SearchButton = () => {
  const searchModal = useDisclosure();

  useShortcutKeys({
    shortcut: shortcut,
    action: searchModal.onOpen,
  });

  return (
    <div className="hidden sm:block">
      <Button
        leftIcon={<LuSearch />}
        variant="secondary"
        className="w-[200px] px-2 text-muted-foreground "
        onClick={searchModal.onOpen}
      >
        <HStack className="w-full">
          <div className="flex flex-grow">Search</div>
          <ShortcutKey variant="small" shortcut={shortcut} />
        </HStack>
      </Button>
      <SearchModal isOpen={searchModal.isOpen} onClose={searchModal.onClose} />
    </div>
  );
};

function useGroupedSubmodules() {
  const modules = useModules();
  const items = useItemsSubmodules();
  // const jobs = useJobsSidebar();
  const inventory = useInventorySubmodules();
  // const scheduling = useSchedulingSidebar();
  // const timecards = useTimecardsSidebar();
  const sales = useSalesSubmodules();
  const purchasing = usePurchasingSubmodules();
  const documents = useDocumentsSubmodules();
  // const messages = useMessagesSidebar();
  const accounting = useAccountingSubmodules();
  const invoicing = useInvoicingSubmodules();
  const users = useUsersSubmodules();
  const settings = useSettingsSubmodules();
  const people = usePeopleSubmodules();
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
    accounting,
    invoicing,
    people,
    resources,
    settings,
    users,
  };

  const ungroupedSubmodules: Record<string, { links: Route[] }> = {
    documents,
    "my account": account,
  };

  const shortcuts = modules.reduce<Record<string, Route[]>>((acc, module) => {
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
          }))
        ),
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
          icon: module.icon,
        })),
      };
    }

    return acc;
  }, {});

  return shortcuts;
}

export default SearchButton;
