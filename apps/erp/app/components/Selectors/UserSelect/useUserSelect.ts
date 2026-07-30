import { getLogger } from "@carbon/logger";
import { useDisclosure, useOutsideClick } from "@carbon/react";
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
import type {
  User,
  UserSelectGroup,
  UserSelectGroupMembers
} from "~/modules/users";
import { path } from "~/utils/path";
import {
  cachedApiQuery,
  getCompanyId,
  userSelectGroupsQuery,
  userSelectMembersQuery,
  userSelectResolveQuery,
  userSelectSearchQuery
} from "~/utils/react-query";

import type {
  GroupNode,
  IndividualOrGroup,
  SelectionGroupWithOptions,
  SelectionItemsById,
  TreeNode,
  UserSelectionGenericQueryFilters,
  UserSelectProps,
  UserSelectViewModel,
  UserWithOptions
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

const logger = getLogger("erp", "user-select");

const PAGE_SIZE = 25;

export default function useUserSelect(props: UserSelectProps) {
  /* Inner Props */
  const innerProps = useMemo(
    () => ({
      ...defaultProps,
      ...props
    }),
    [props]
  );

  /* Refs */
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listBoxRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<Element>(null);
  const focusableNodes = useRef<Record<string, TreeNode>>({});
  const uidToGroupId = useRef<Record<string, string>>({});
  const resolveRequested = useRef<Set<string>>(new Set());
  const instanceId = useId();

  /* Disclosures */
  const dropdown = useDisclosure();

  /* Data */
  const [topLevelGroups, setTopLevelGroups] = useState<UserSelectGroup[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [membersById, setMembersById] = useState<
    Record<string, UserSelectGroupMembers>
  >({});
  const [loadingGroups, setLoadingGroups] = useState<Record<string, boolean>>(
    {}
  );
  const [expandedUids, setExpandedUids] = useState<Set<string>>(new Set());
  const [searchResults, setSearchResults] = useState<{
    groups: UserSelectGroup[];
    users: User[];
  } | null>(null);
  const [searching, setSearching] = useState(false);
  const [errors, setErrors] = useState<{ message: string } | undefined>(
    undefined
  );

  /* Input */
  const [controlledValue, setControlledValue] = useState("");

  /* Focus */
  const [focusedId, setFocusedId] = useState<string | null>(null);

  /* Selections */
  const [selectionItemsById, setSelectionItemsById] =
    useState<SelectionItemsById>(
      innerProps.selections && innerProps.selections.length > 0
        ? makeSelectionItemsById(innerProps.selections, innerProps.isMulti)
        : {}
    );

  /* Data fetching */

  const loadPage = useCallback(
    async (offset: number, append: boolean) => {
      const companyId = getCompanyId();
      const type = innerProps.type ?? null;
      if (append) {
        setLoadingMore(true);
      } else {
        setInitialLoading(true);
      }
      try {
        const data = await cachedApiQuery<{
          groups: UserSelectGroup[];
          hasMore: boolean;
        }>(
          userSelectGroupsQuery(companyId, type, offset),
          path.to.api.userSelectGroups(innerProps.type, offset, PAGE_SIZE)
        );
        setTopLevelGroups((prev) => {
          const base = append ? prev : [];
          const seen = new Set(base.map((g) => g.id));
          return base.concat(data.groups.filter((g) => !seen.has(g.id)));
        });
        setHasMore(data.hasMore);
        setErrors(undefined);
      } catch (err) {
        logger.error("Failed to load groups", { error: err });
        setErrors({ message: "Failed to load groups" });
      } finally {
        if (append) {
          setLoadingMore(false);
        } else {
          setInitialLoading(false);
        }
      }
    },
    [innerProps.type]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset + first page on type change only
  useEffect(() => {
    setTopLevelGroups([]);
    setHasMore(false);
    setMembersById({});
    setExpandedUids(new Set());
    setSearchResults(null);
    loadPage(0, false);
  }, [innerProps.type]);

  const loadMore = useCallback(() => {
    if (loadingMore || initialLoading || !hasMore) return;
    loadPage(topLevelGroups.length, true);
  }, [loadingMore, initialLoading, hasMore, topLevelGroups.length, loadPage]);

  const fetchMembers = useCallback(
    async (groupId: string): Promise<UserSelectGroupMembers | null> => {
      const companyId = getCompanyId();
      setLoadingGroups((prev) =>
        prev[groupId] ? prev : { ...prev, [groupId]: true }
      );
      try {
        const data = await cachedApiQuery<UserSelectGroupMembers>(
          userSelectMembersQuery(companyId, groupId),
          path.to.api.userSelectGroupMembers(groupId)
        );
        setMembersById((prev) => ({ ...prev, [groupId]: data }));
        return data;
      } catch (err) {
        logger.error("Failed to fetch group members", { error: err });
        return null;
      } finally {
        setLoadingGroups((prev) => ({ ...prev, [groupId]: false }));
      }
    },
    []
  );

  const prefetchGroup = useCallback(
    (groupId: string) => {
      if (!groupId || membersById[groupId] || loadingGroups[groupId]) return;
      void fetchMembers(groupId);
    },
    [membersById, loadingGroups, fetchMembers]
  );

  /* View model — the lazily-built tree (or flat search results) */

  const viewModel = useMemo<UserSelectViewModel>(() => {
    uidToGroupId.current = {};
    const { usersOnly, queryFilters } = innerProps;
    const allowedIds = queryFilters?.allowedIds;

    const toUserOption = (user: User, parentUid: string): UserWithOptions => ({
      ...user,
      uid: getOptionId(parentUid, user.id),
      label: user.fullName || ""
    });

    const q = controlledValue.trim();

    if (q.length >= 2 && searchResults) {
      const groups: SelectionGroupWithOptions[] = usersOnly
        ? []
        : searchResults.groups.map((g) => ({
            ...g,
            users: [],
            memberCount: g.userCount,
            uid: getOptionId("search", g.id),
            label: g.name || ""
          }));
      const users = searchResults.users
        .filter((u) => !allowedIds?.length || allowedIds.includes(u.id))
        .map((u) => toUserOption(u, "search"));
      return { mode: "search", groups, users, searching };
    }

    const isVisibleGroup = (g: UserSelectGroup) =>
      !usersOnly || g.userCount + g.groupCount > 0;

    const buildNode = (
      group: UserSelectGroup,
      parentUid: string,
      ancestry: Set<string>
    ): GroupNode => {
      const uid = getGroupUid(parentUid, group.id);
      uidToGroupId.current[uid] = group.id;
      const expanded = expandedUids.has(uid);
      const raw = membersById[group.id];
      let members: GroupNode["members"] = null;
      if (raw) {
        const nextAncestry = new Set(ancestry).add(group.id);
        members = {
          groups: raw.groups
            .filter((cg) => !nextAncestry.has(cg.id))
            .filter(isVisibleGroup)
            .map((cg) => buildNode(cg, uid, nextAncestry)),
          users: raw.users
            .filter((u) => !allowedIds?.length || allowedIds.includes(u.id))
            .map((u) => toUserOption(u, uid))
        };
      }
      return {
        uid,
        group,
        expanded,
        loading: !!loadingGroups[group.id],
        members
      };
    };

    let top = topLevelGroups.filter(isVisibleGroup);
    if (q.length === 1) {
      top = top.filter((g) => stringContainsTerm(g.name || "", q));
    }

    return {
      mode: "browse",
      nodes: top.map((g) => buildNode(g, instanceId, new Set())),
      hasMore,
      loadingMore
    };
  }, [
    innerProps,
    controlledValue,
    searchResults,
    searching,
    topLevelGroups,
    membersById,
    expandedUids,
    loadingGroups,
    hasMore,
    loadingMore,
    instanceId
  ]);

  /* Resolve preselected ids (users AND groups) not yet known locally */

  useEffect(() => {
    const value = innerProps.value;
    if (value === undefined || value === null) return;
    const values = (Array.isArray(value) ? value : [value]).filter(Boolean);
    const missing = values.filter(
      (val) => !selectionItemsById[val] && !resolveRequested.current.has(val)
    );
    if (missing.length === 0) return;
    missing.forEach((val) => {
      resolveRequested.current.add(val);
    });

    const companyId = getCompanyId();
    cachedApiQuery<{
      users: User[];
      groups: { id: string; name: string }[];
    }>(
      userSelectResolveQuery(companyId, missing),
      path.to.api.userSelectResolve(missing)
    )
      .then((data) => {
        setSelectionItemsById((prev) => {
          let changed = false;
          const next = { ...prev };
          data.users.forEach((u) => {
            if (!next[u.id]) {
              next[u.id] = {
                ...u,
                uid: getOptionId("preselected", u.id),
                label: u.fullName || ""
              };
              changed = true;
            }
          });
          data.groups.forEach((g) => {
            if (!next[g.id]) {
              next[g.id] = {
                id: g.id,
                name: g.name,
                isEmployeeTypeGroup: false,
                isCustomerOrgGroup: false,
                isCustomerTypeGroup: false,
                isSupplierOrgGroup: false,
                isSupplierTypeGroup: false,
                userCount: 0,
                groupCount: 0,
                users: [],
                memberCount: 0,
                uid: getOptionId("preselected", g.id),
                label: g.name || ""
              };
              changed = true;
            }
          });
          return changed ? next : prev;
        });
      })
      .catch((err) =>
        logger.error("Failed to resolve preselected values", { error: err })
      );
  }, [innerProps.value, selectionItemsById]);

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

  const clear = useCallback(() => {
    setControlledValue("");
    setSearchResults(null);
  }, []);

  const resetFocus = useCallback(() => {
    setFocusedId(null);
    focusInput();
    if (listBoxRef) {
      listBoxRef.current?.scrollTo(0, 0);
    }
  }, [focusInput]);

  const onGroupExpand = useCallback(
    (uid: string) => {
      setExpandedUids((prev) => {
        const next = new Set(prev);
        next.add(uid);
        return next;
      });
      const groupId = uidToGroupId.current[uid];
      if (groupId) prefetchGroup(groupId);
    },
    [prefetchGroup]
  );

  const onGroupCollapse = useCallback((uid: string) => {
    setExpandedUids((prev) => {
      const next = new Set(prev);
      next.delete(uid);
      return next;
    });
  }, []);

  const isExpanded = useCallback(
    (uid: string) => expandedUids.has(uid),
    [expandedUids]
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
    return focusableNodes.current[id]?.expandable ?? false;
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
    (uid: string): IndividualOrGroup | undefined => {
      if (viewModel.mode === "search") {
        return (
          viewModel.groups.find((g) => g.uid === uid) ??
          viewModel.users.find((u) => u.uid === uid)
        );
      }

      let found: IndividualOrGroup | undefined;
      const walk = (nodes: GroupNode[]) => {
        for (const node of nodes) {
          if (found) return;
          if (node.uid === uid) {
            found = toGroupSelection(node.group, node.uid);
            return;
          }
          if (node.members) {
            const user = node.members.users.find((u) => u.uid === uid);
            if (user) {
              found = user;
              return;
            }
            walk(node.members.groups);
          }
        }
      };
      walk(viewModel.nodes);
      return found;
    },
    [viewModel]
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

  const debouncedInputChange = useMemo(() => {
    const { queryFilters, type } = innerProps;
    return debounce(async (search: string) => {
      const q = search.trim();
      if (q.length < 2) {
        setSearchResults(null);
        setSearching(false);
        resetFocus();
        return;
      }

      const companyId = getCompanyId();
      const filtersKey = `${queryFilters?.excludeSelf ?? ""}|${queryFilters?.allowedIds?.join(",") ?? ""}`;
      let searchUrl = path.to.api.userSelectSearch(q, type);
      if (queryFilters?.excludeSelf) {
        searchUrl += "&excludeSelf=true";
      }
      if (queryFilters?.allowedIds?.length) {
        searchUrl += `&allowedIds=${queryFilters.allowedIds.join(",")}`;
      }

      setSearching(true);
      try {
        const data = await cachedApiQuery<{
          groups: UserSelectGroup[];
          users: User[];
        }>(
          userSelectSearchQuery(companyId, type ?? null, q, filtersKey),
          searchUrl
        );
        setSearchResults(data);
      } catch (e) {
        logger.error("Failed to search users", { error: e });
      } finally {
        setSearching(false);
        resetFocus();
      }
    }, 240);
  }, [resetFocus, innerProps]);

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
      // Keep the hydration effect from re-resolving an id the user just
      // removed while the wrapper's value prop is still one render behind.
      resolveRequested.current.add(id);
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

  /**
   * Replace a selected group with its direct members (users + child groups).
   * Members are fetched on demand if not already loaded.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onExplode = useCallback(
    (selectionItem: IndividualOrGroup) => {
      if (!("users" in selectionItem)) return;
      const { id } = selectionItem;
      const { queryFilters } = innerProps;

      // The wrapper's value prop lags one render behind the onChange below;
      // without this the hydration effect resolves the exploded group id and
      // re-adds it as a ghost chip.
      resolveRequested.current.add(id);

      void (async () => {
        const members = membersById[id] ?? (await fetchMembers(id));
        if (!members) return;

        const allowedIds = queryFilters?.allowedIds;
        const users = members.users.filter(
          (u) => !allowedIds?.length || allowedIds.includes(u.id)
        );

        setSelectionItemsById((prevSelectionItems) => {
          if (!(id in prevSelectionItems)) return prevSelectionItems;

          // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
          const { [id]: removed, ...newSelectionItems } = prevSelectionItems;

          users.forEach((user) => {
            newSelectionItems[user.id] = {
              ...user,
              uid: getOptionId(id, user.id),
              label: user.fullName || ""
            };
          });

          members.groups.forEach((group) => {
            newSelectionItems[group.id] = toGroupSelection(
              group,
              getOptionId(id, group.id)
            );
          });

          onChange(Object.values(newSelectionItems));
          return newSelectionItems;
        });
      })();
    },
    [membersById, fetchMembers, innerProps, onChange, setSelectionItemsById]
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (innerProps.disabled) {
        return;
      }

      switch (event.key) {
        case "ArrowLeft":
          if (focusedId) {
            if (hasChildren(focusedId) && isExpanded(focusedId)) {
              onGroupCollapse(focusedId);
            } else if (hasParent(focusedId)) {
              const { parentId } = focusableNodes.current[focusedId];
              onGroupCollapse(parentId!);
              setFocus(parentId!);
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
          if (focusedId) {
            if (hasChildren(focusedId) && innerProps.usersOnly) {
              // groups aren't selectable in usersOnly mode — toggle expansion
              if (isExpanded(focusedId)) {
                onGroupCollapse(focusedId);
              } else {
                onGroupExpand(focusedId);
              }
            } else {
              onSelect(getSelectionById(focusedId));
              clear();
              commit();
            }
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
            if (hasChildren(focusedId) && innerProps.usersOnly) {
              if (isExpanded(focusedId)) {
                onGroupCollapse(focusedId);
              } else {
                onGroupExpand(focusedId);
              }
            } else {
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
      innerProps.usersOnly,
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
    viewModel,
    errors,
    loading: initialLoading,
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
    // pagination
    loadMore,
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

function getGroupUid(parentUid: string, groupId: string) {
  return `${parentUid}_${groupId}_group`;
}

/** Build the selection item for a group (users stays [] until exploded). */
function toGroupSelection(
  group: UserSelectGroup,
  uid: string
): SelectionGroupWithOptions {
  return {
    ...group,
    users: [],
    memberCount: group.userCount + group.groupCount,
    uid,
    label: group.name || ""
  };
}

function checked(item: IndividualOrGroup): IndividualOrGroup {
  return {
    ...item,
    isChecked: true
  };
}

export function isGroup(item: IndividualOrGroup) {
  return "users" in item;
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
