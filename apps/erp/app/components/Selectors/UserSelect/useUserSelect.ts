import { useDisclosure, useOutsideClick } from "@carbon/react";
import type { PostgrestError } from "@supabase/supabase-js";
import debounce from "lodash/debounce";
import words from "lodash/words";
import type { AriaAttributes, ChangeEvent, KeyboardEvent } from "react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from "react";
import { useFetcher } from "react-router";
import type { Group, User } from "~/modules/users";
import { path } from "~/utils/path";

import type {
  IndividualOrGroup,
  OptionGroup,
  SelectionItemsById,
  TreeNode,
  UserSelectionGenericQueryFilters,
  UserSelectProps
} from "./types";

const defaultProps = {
  alwaysSelected: [],
  accessibilityLabel: "User selector",
  checkedSelections: false,
  disabled: false,
  hideSelections: false,
  id: "MultiUserSelect",
  innerInputRender: null,
  isMulti: false,
  placeholder: "",
  queryFilters: {} as UserSelectionGenericQueryFilters,
  readOnly: false,
  resetAfterSelection: false,
  selections: [] as IndividualOrGroup[],
  selectionsMaxHeight: 400,
  showAvatars: false,
  usersOnly: false,
  // biome-ignore lint/suspicious/noEmptyBlockStatements: suppressed due to migration
  onCancel: () => {}
};

export default function useUserSelect(props: UserSelectProps) {
  /* Inner Props */
  const innerProps = useMemo(
    () => ({
      ...defaultProps,
      ...props
    }),
    [props]
  );

  /* Data Fetching */
  const groupsFetcher = useFetcher<{
    groups: Group[];
    errors?: PostgrestError;
  }>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    groupsFetcher.load(path.to.api.groupsByType(innerProps.type));
  }, [innerProps.type]);

  /* Refs */
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listBoxRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<Element>(null);
  const focusableNodes = useRef<Record<string, TreeNode>>({});
  const instanceId = useId();

  /* Disclosures */
  const dropdown = useDisclosure();

  /* Fetch States */
  const [loadingGroups, setLoadingGroups] = useState<Record<string, boolean>>(
    {}
  );
  const [fetchedMembers, setFetchedMembers] = useState<Record<string, User[]>>(
    {}
  );
  const searchCache = useRef<Record<string, User[]>>({});

  /* Input */
  const [controlledValue, setControlledValue] = useState("");

  /* Output */
  const [filteredOptionGroups, setFilteredOptionGroups] = useState<
    OptionGroup[]
  >([]);

  /* Focus */
  const [focusedId, setFocusedId] = useState<string | null>(null);

  /* Selections */
  const [selectionItemsById, setSelectionItemsById] =
    useState<SelectionItemsById>(
      innerProps.selections && innerProps.selections.length > 0
        ? makeSelectionItemsById(innerProps.selections, innerProps.isMulti)
        : {}
    );

  // Convert the tree from the server into a format that is easier to work with
  const optionGroups = useMemo<OptionGroup[]>(() => {
    const makeGroupItems = (
      group: Group,
      groupId: string
    ): IndividualOrGroup[] => {
      const result: IndividualOrGroup[] = [];

      if (!innerProps.usersOnly) {
        result.push({
          ...group.data,
          uid: getOptionId(groupId, group.data.id),
          label: group.data.name || "",
          children: group.children
        });

        const subgroups = group.children.map((subgroup) => ({
          ...subgroup.data,
          uid: getOptionId(groupId, subgroup.data.id),
          label: subgroup.data.name || "",
          children: subgroup.children
        }));

        result.push(...subgroups);
      }

      const users = (
        fetchedMembers[group.data.id] ||
        group.data.users ||
        []
      ).map((user) => {
        return {
          ...user,
          uid: getOptionId(groupId, user.id),
          label: user.fullName || ""
        };
      });

      result.push(...users);

      return result;
    };

    return !groupsFetcher.data || !groupsFetcher.data.groups
      ? []
      : groupsFetcher.data.groups.reduce<OptionGroup[]>((acc, group) => {
          if (
            !innerProps.usersOnly ||
            (group.data.users && group.data.users.length) ||
            (fetchedMembers[group.data.id] &&
              fetchedMembers[group.data.id].length)
          ) {
            const uid = getGroupId(instanceId, group.data.id);
            return acc.concat({
              uid,
              expanded: false,
              items: makeGroupItems(group as Group, uid),
              name: group.data.name || ""
            });
          }
          return acc;
        }, []);
  }, [groupsFetcher.data, innerProps.usersOnly, instanceId, fetchedMembers]);

  /* Pre-populate controlled component after data loads */
  useEffect(() => {
    if (innerProps.value && optionGroups && optionGroups.length > 0) {
      const flattened = optionGroups.reduce<IndividualOrGroup[]>(
        (acc, group) => acc.concat(group.items),
        []
      );
      const values = Array.isArray(innerProps.value)
        ? innerProps.value
        : [innerProps.value];

      const newSelections: SelectionItemsById = {};
      const missingUserIds: string[] = [];

      values.forEach((val) => {
        if (!selectionItemsById[val]) {
          const found = flattened.find((item) => item.id === val);
          if (found) {
            newSelections[val] = found;
          } else if (typeof val === "string" && !val.startsWith("group_")) {
            missingUserIds.push(val);
          }
        }
      });

      if (Object.keys(newSelections).length > 0) {
        setSelectionItemsById((prev) => ({ ...prev, ...newSelections }));
      }

      if (missingUserIds.length > 0) {
        const fetchMissing = async () => {
          try {
            const res = await fetch(path.to.api.usersBatch(missingUserIds));
            const data = await res.json();
            if (data.users && data.users.length > 0) {
              setSelectionItemsById((prev) => {
                const next = { ...prev };
                data.users.forEach((u: User) => {
                  if (!next[u.id]) {
                    next[u.id] = {
                      ...u,
                      uid: getOptionId("preselected", u.id),
                      label: u.fullName || ""
                    };
                  }
                });
                return next;
              });
            }
          } catch (err) {
            console.error("Failed to fetch preselected users", err);
          }
        };
        fetchMissing();
      }
    }
  }, [optionGroups, innerProps.value, selectionItemsById]);

  const makeFilteredOptionGroups = useCallback(
    (query?: string): OptionGroup[] =>
      optionGroups.reduce((acc, group) => {
        if (query?.trim()) {
          const matches = group.items.filter((item) =>
            stringContainsTerm(item.label, query)
          );
          if (matches && matches.length) {
            return acc.concat({
              ...group,
              expanded: true,
              items: matches
            });
          } else {
            return acc;
          }
        } else {
          return acc.concat(group);
        }
      }, [] as OptionGroup[]),
    [optionGroups]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    // Preserve each group's expanded state so it doesn't collapse when its
    // lazily-fetched members arrive.
    setFilteredOptionGroups((previousGroups) => {
      const expandedByUid = new Map(
        previousGroups.map((group) => [group.uid, group.expanded])
      );
      return makeFilteredOptionGroups().map((group) =>
        expandedByUid.has(group.uid)
          ? { ...group, expanded: expandedByUid.get(group.uid)! }
          : group
      );
    });
  }, [optionGroups, makeFilteredOptionGroups, setFilteredOptionGroups]);

  /* Event Handlers */

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const commit = useCallback(() => {
    dropdown.onClose();
    setFocusedId(null);
  }, [dropdown, setFocusedId]);

  useOutsideClick({
    ref: containerRef,
    handler: () => {
      clear();
      commit();
    }
  });

  const focusInput = useCallback(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const clear = useCallback(() => {
    setFilteredOptionGroups(makeFilteredOptionGroups());
    setControlledValue("");
  }, [makeFilteredOptionGroups, setControlledValue, setFilteredOptionGroups]);

  const resetFocus = useCallback(() => {
    setFocusedId(null);
    focusInput();
    if (listBoxRef) {
      listBoxRef.current?.scrollTo(0, 0);
    }
  }, [focusInput]);

  const prefetchGroup = useCallback(
    (uid: string) => {
      const groupId = uid.split("_")[1];
      if (groupId && !fetchedMembers[groupId] && !loadingGroups[groupId]) {
        setLoadingGroups((prev) => ({ ...prev, [groupId]: true }));
        fetch(path.to.api.groupMembers(groupId))
          .then((res) => res.json())
          .then((data) => {
            if (data.users) {
              let users = data.users as User[];
              const { queryFilters } = innerProps;
              if (queryFilters?.allowedIds?.length) {
                users = users.filter((u) =>
                  queryFilters.allowedIds!.includes(u.id)
                );
              }
              setFetchedMembers((prev) => ({ ...prev, [groupId]: users }));
            }
          })
          .catch((err) => console.error("Failed to prefetch group", err))
          .finally(() => {
            setLoadingGroups((prev) => ({ ...prev, [groupId]: false }));
          });
      }
    },
    [fetchedMembers, loadingGroups, innerProps]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onGroupExpand = useCallback(
    (uid: string) => {
      setFilteredOptionGroups((previousGroups) =>
        previousGroups.map((group) =>
          group.uid === uid ? { ...group, expanded: true } : group
        )
      );
      prefetchGroup(uid);
    },
    [setFilteredOptionGroups, prefetchGroup]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onGroupCollapse = useCallback(
    (uid: string) =>
      setFilteredOptionGroups((previousGroups) =>
        previousGroups.map((group) =>
          group.uid === uid ? { ...group, expanded: false } : group
        )
      ),
    [setFilteredOptionGroups]
  );

  const isExpanded = useCallback(
    (uid: string) =>
      filteredOptionGroups.some((g) => g.uid === uid && g.expanded),
    [filteredOptionGroups]
  );

  const getFirstNode = useCallback(() => {
    return Object.values(focusableNodes.current).find(
      (node) => node !== undefined && node.previousId === undefined
    );
  }, []);

  const getLastNode = useCallback(() => {
    return Object.values(focusableNodes.current).find(
      (node) => node !== undefined && node.nextId === undefined
    );
  }, []);

  const getNextNode = useCallback(
    (currentId: string | null) => {
      if (currentId === null) {
        if (!dropdown.isOpen) dropdown.onOpen();
        return getFirstNode();
      }

      const { nextId } = focusableNodes.current[currentId];
      if (nextId) {
        return focusableNodes.current[nextId];
      }
      resetFocus();
      return null;
    },
    [dropdown, getFirstNode, resetFocus]
  );

  const getPreviousNode = useCallback(
    (currentId: string | null) => {
      if (currentId === null) return getLastNode();

      const { previousId } = focusableNodes.current[currentId];
      if (previousId) {
        return focusableNodes.current[previousId];
      }
      resetFocus();
      return null;
    },
    [getLastNode, resetFocus]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const hasParent = useCallback(
    (id: string) => {
      const { parentId } = focusableNodes.current[id];
      return parentId !== undefined;
    },
    [focusableNodes]
  );

  const hasChildren = useCallback((id: string) => {
    return focusableNodes.current[id].expandable ?? false;
  }, []);

  const scrollTo = useCallback((elementId: string, delay: boolean) => {
    const element = document.getElementById(elementId);
    const block = "nearest";
    if (element) {
      if (delay) {
        setTimeout(() => {
          element.scrollIntoView({ block });
        }, 80);
      } else {
        element.scrollIntoView({ block });
      }
    }
  }, []);

  const getSelectionById = useCallback(
    (uid: string) => {
      for (const group of filteredOptionGroups) {
        const result = group.items.find((item) => item.uid === uid);
        if (result) return result;
      }

      return undefined;
    },
    [filteredOptionGroups]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const setFocus = useCallback(
    (command: string) => {
      let nextFocusedId = focusedId;
      let scrollDelay = false;
      switch (command) {
        case "first":
          nextFocusedId = getFirstNode()?.uid ?? null;
          break;
        case "last":
          nextFocusedId = getLastNode()?.uid ?? null;
          break;
        case "previous":
          nextFocusedId = getPreviousNode(focusedId)?.uid ?? null;
          break;
        case "next":
          nextFocusedId = getNextNode(focusedId)?.uid ?? null;
          break;
        default:
          nextFocusedId = command;
          scrollDelay = true;
      }

      setFocusedId(nextFocusedId);

      if (nextFocusedId) {
        const element = document.getElementById(nextFocusedId);
        if (element) element.focus();
        scrollTo(nextFocusedId, scrollDelay);
      }
    },
    [
      focusedId,
      getFirstNode,
      getLastNode,
      getPreviousNode,
      getNextNode,
      scrollTo,
      setFocusedId
    ]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const debouncedInputChange = useMemo(() => {
    const { queryFilters } = innerProps;
    return debounce(async (search: string) => {
      const q = search.trim();
      if (q.length >= 2) {
        const cacheKey = `${q}|${queryFilters?.excludeSelf ?? ""}|${queryFilters?.allowedIds?.join(",") ?? ""}`;
        if (searchCache.current[cacheKey]) {
          const searchResults = searchCache.current[cacheKey].map(
            (user: User) => ({
              ...user,
              uid: getOptionId("search", user.id),
              label: user.fullName || ""
            })
          );

          setFilteredOptionGroups([
            {
              uid: "search_results",
              expanded: true,
              items: searchResults,
              name: "Search Results"
            }
          ]);
          resetFocus();
          return;
        }

        try {
          let searchUrl = path.to.api.usersSearch(q);
          if (queryFilters?.excludeSelf) {
            searchUrl += "&excludeSelf=true";
          }
          if (queryFilters?.allowedIds?.length) {
            searchUrl += `&allowedIds=${queryFilters.allowedIds.join(",")}`;
          }

          const res = await fetch(searchUrl);
          const data = await res.json();
          if (data.users && data.users.length > 0) {
            searchCache.current[cacheKey] = data.users;
            const searchResults = data.users.map((user: User) => ({
              ...user,
              uid: getOptionId("search", user.id),
              label: user.fullName || ""
            }));

            setFilteredOptionGroups([
              {
                uid: "search_results",
                expanded: true,
                items: searchResults,
                name: "Search Results"
              }
            ]);
          } else {
            setFilteredOptionGroups([]);
          }
        } catch (e) {
          console.error(e);
        }
      } else {
        setFilteredOptionGroups(makeFilteredOptionGroups(search));
      }
      resetFocus();
    }, 240);
  }, [
    makeFilteredOptionGroups,
    resetFocus,
    setFilteredOptionGroups,
    innerProps
  ]);

  const onInputFocus = useCallback(() => {
    dropdown.onOpen();
    resetFocus();
  }, [dropdown, resetFocus]);

  const onInputBlur = useCallback(
    (e: any) => {
      if (innerProps.onBlur && typeof innerProps.onBlur === "function") {
        innerProps.onBlur(e);
      }
    },
    [innerProps]
  );

  const onMouseOver = useCallback(() => {
    setFocusedId(null);
  }, []);

  const onChange = useCallback(
    (selections: IndividualOrGroup[]) => {
      if (innerProps.onChange && typeof innerProps.onChange === "function") {
        innerProps.onChange(selections);
      }
    },
    [innerProps]
  );

  const onCheckedChange = useCallback(
    (selections: IndividualOrGroup[]) => {
      if (
        innerProps.onCheckedSelectionsChange &&
        typeof innerProps.onChange === "function"
      ) {
        innerProps.onCheckedSelectionsChange(selections);
      }
    },
    [innerProps]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onSelect = useCallback(
    (selectionItem?: IndividualOrGroup) => {
      if (selectionItem === undefined) return;
      setSelectionItemsById((previousSelections) => {
        const nextSelections = innerProps.isMulti
          ? {
              ...previousSelections
            }
          : {};

        nextSelections[selectionItem.id] = checked(selectionItem);

        onChange(Object.values(nextSelections));
        return nextSelections;
      });
      if (innerProps.isMulti && !innerProps.resetAfterSelection) {
        setFocusedId(selectionItem.uid!);
      } else {
        commit();
        clear();
      }
    },
    [
      clear,
      commit,
      innerProps.isMulti,
      innerProps.resetAfterSelection,
      onChange,
      setFocusedId,
      setSelectionItemsById
    ]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onDeselect = useCallback(
    (selectionItem: IndividualOrGroup) => {
      if (selectionItem === undefined) return;
      const { id } = selectionItem;
      setSelectionItemsById((previousSelections) => {
        if (id in previousSelections) {
          // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
          const { [id]: removed, ...newSelectionCodes } = previousSelections;

          onChange(Object.values(newSelectionCodes));
          return newSelectionCodes;
        }

        return previousSelections;
      });
    },
    [onChange, setSelectionItemsById]
  );

  const onToggle = useCallback(
    (selectionItem?: IndividualOrGroup) => {
      if (selectionItem === undefined) return;
      if (selectionItem.id in selectionItemsById) {
        onDeselect(selectionItem);
      } else {
        onSelect(selectionItem);
      }
    },
    [onDeselect, onSelect, selectionItemsById]
  );

  const onToggleChecked = useCallback(
    (selectionItem?: IndividualOrGroup) => {
      if (selectionItem === undefined) return;
      setSelectionItemsById((previousSelections) => {
        const nextSelections = {
          ...previousSelections,
          [selectionItem.id]: toggleChecked(selectionItem)
        };

        onCheckedChange(Object.values(nextSelections));
        return nextSelections;
      });
    },
    [onCheckedChange]
  );

  const removeSelections = useCallback(() => {
    Object.values(selectionItemsById).forEach((item) => {
      onDeselect(item);
    });
  }, [onDeselect, selectionItemsById]);

  const onClearInput = useCallback(() => {
    clear();
    if (!innerProps.isMulti) {
      removeSelections();
    }
  }, [clear, innerProps.isMulti, removeSelections]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onInputChange = useCallback(
    ({ target }: ChangeEvent<HTMLInputElement>): void => {
      setControlledValue(target.value);
      debouncedInputChange(target.value);

      if (target.value?.length > 0) {
        dropdown.onOpen();
      } else if (!innerProps.isMulti) {
        removeSelections();
      }
    },
    [
      debouncedInputChange,
      dropdown,
      innerProps.isMulti,
      removeSelections,
      setControlledValue
    ]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onExplode = useCallback(
    (selectionItem: IndividualOrGroup) => {
      if (!("users" in selectionItem)) return;

      const { id, users, children } = selectionItem;

      setSelectionItemsById((prevSelectionItems) => {
        if (id in prevSelectionItems) {
          // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
          const { [id]: removed, ...newSelectionItems } = prevSelectionItems;

          users.forEach((user) => {
            newSelectionItems[user.id] = {
              ...user,
              uid: getOptionId(id, user.id),
              label: user.fullName || ""
            };
          });

          children?.forEach((group) => {
            newSelectionItems[group.data.id] = {
              ...group.data,
              uid: getOptionId(id, group.data.id),
              label: group.data.name || ""
            };
          });

          onChange(Object.values(newSelectionItems));
          return newSelectionItems;
        }

        return prevSelectionItems;
      });
    },
    [onChange, setSelectionItemsById]
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (innerProps.disabled) {
        return;
      }

      switch (event.key) {
        case "ArrowLeft":
          if (focusedId) {
            if (hasParent(focusedId)) {
              const { parentId } = focusableNodes.current[focusedId];
              onGroupCollapse(parentId!);
              setFocus(parentId!);
            } else {
              onGroupCollapse(focusedId);
            }
            break;
          } else {
            return;
          }

        case "ArrowRight":
          if (focusedId && hasChildren(focusedId)) {
            if (isExpanded(focusedId)) {
              setFocus("next");
            } else {
              onGroupExpand(focusedId);
            }
            break;
          } else {
            return;
          }

        case "Tab":
          clear();
          commit();
          return;
        case "Enter":
          if (focusedId && hasParent(focusedId)) {
            onSelect(getSelectionById(focusedId));
            clear();
            commit();
            break;
          }
          break;
        case "Escape":
          if (dropdown.isOpen) {
            commit();
          } else {
            clear();
          }
          break;
        case " ": // space
          if (focusedId) {
            if (hasParent(focusedId)) {
              onToggle(getSelectionById(focusedId));
            }
            break;
          }
          return;
        case "ArrowUp":
          setFocus("previous");
          break;
        case "ArrowDown":
          if (dropdown.isOpen) {
            setFocus("next");
          } else {
            dropdown.onOpen();
          }
          break;
        case "Home":
          if (!dropdown.isOpen) return;
          setFocus("first");
          break;
        case "End":
          if (!dropdown.isOpen) return;
          setFocus("last");
          break;
        default:
          resetFocus();
          return;
      }
      event.preventDefault();
    },
    [
      commit,
      dropdown,
      focusedId,
      getSelectionById,
      hasParent,
      hasChildren,
      isExpanded,
      innerProps.disabled,
      clear,
      onGroupCollapse,
      onGroupExpand,
      onSelect,
      onToggle,
      resetFocus,
      setFocus
    ]
  );

  /* Accessibility */

  const popoverProps = useMemo<AriaAttributes>(() => ({}), []);

  const listBoxProps = useMemo<AriaAttributes & { id: string }>(
    () => ({
      id: instanceId,
      role: "tree",
      tabIndex: -1
    }),
    [instanceId]
  );

  const inputProps = useMemo<AriaAttributes>(
    () => ({
      role: "combobox",
      "aria-expanded": dropdown.isOpen,
      "aria-controls": dropdown.isOpen ? instanceId : undefined,
      "aria-haspopup": "tree",
      "aria-autocomplete": "list",
      "aria-activedescendant": focusedId ?? undefined,
      autoComplete: "off",
      autoCorrect: "off"
    }),
    [instanceId, dropdown.isOpen, focusedId]
  );

  const aria = useMemo(
    () => ({
      inputProps,
      listBoxProps,
      popoverProps
    }),
    [inputProps, listBoxProps, popoverProps]
  );

  let inputValue =
    innerProps.isMulti || focusedId || controlledValue
      ? controlledValue
      : (Object.values(selectionItemsById)?.[0]?.label ?? "");

  return {
    aria,
    groups: filteredOptionGroups,
    errors: groupsFetcher.data?.errors,
    loading: groupsFetcher.state === "loading",
    loadingGroups,
    selectionItemsById,
    // focus
    instanceId,
    focusedId,
    // filters
    inputValue,
    // disclosures
    dropdown,
    // props
    innerProps,
    refs: {
      containerRef,
      inputRef,
      listBoxRef,
      popoverRef,
      buttonRef,
      focusableNodes
    },
    // event handlers
    onClearInput,
    onKeyDown,
    onGroupCollapse,
    onGroupExpand,
    prefetchGroup,
    onInputChange,
    onInputBlur,
    onInputFocus,
    onSelect,
    onDeselect,
    onToggleChecked,
    onExplode,
    onMouseOver,
    setControlledValue,
    setSelectionItemsById
  };
}

function getOptionId(groupId: string, optionId: string) {
  return `${groupId}_${optionId}_option`;
}

function getGroupId(instanceId: string, groupId: string) {
  return `${instanceId}_${groupId}_group`;
}

function checked(item: IndividualOrGroup): IndividualOrGroup {
  return {
    ...item,
    isChecked: true
  };
}

export function isGroup(item: IndividualOrGroup) {
  return (
    ("users" in item && item.users?.length > 0) ||
    ("children" in item && item?.children?.length)
  );
}

function toggleChecked(item: IndividualOrGroup): IndividualOrGroup {
  return {
    ...item,
    isChecked: !item.isChecked || false
  };
}

function makeSelectionItemsById(
  input: IndividualOrGroup[],
  isMulti: boolean
): SelectionItemsById {
  const result: SelectionItemsById = {};
  // biome-ignore lint/suspicious/useIterableCallbackReturn: suppressed due to migration
  input.forEach((item) => {
    if (!(item.id in result)) {
      result[item.id] = checked(item);
      // early exit for signle user select
      if (!isMulti) return result;
    }
  });
  return result;
}

function stringContainsTerm(input: string, filter: string) {
  const i = input.toLocaleLowerCase().trim();
  const f = filter.toLocaleLowerCase().trim();
  if (i.startsWith(f)) {
    return true;
  }

  const filterTokens = words(f);
  const inputTokens = words(i);
  return filterTokens.every((fToken) =>
    inputTokens.some((iToken) => iToken.startsWith(fToken))
  );
}
