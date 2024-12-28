import { useDisclosure, useOutsideClick } from "@carbon/react";
import { useFetcher } from "@remix-run/react";
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
  useState,
} from "react";
import type { Group } from "~/modules/users";
import { path } from "~/utils/path";

import type {
  IndividualOrGroup,
  OptionGroup,
  SelectionItemsById,
  TreeNode,
  UserSelectionGenericQueryFilters,
  UserSelectProps,
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
  onCancel: () => {},
};

export default function useUserSelect(props: UserSelectProps) {
  /* Inner Props */
  const innerProps = useMemo(
    () => ({
      ...defaultProps,
      ...props,
    }),
    [props]
  );

  /* Data Fetching */
  const groupsFetcher = useFetcher<{
    groups: Group[];
    errors?: PostgrestError;
  }>();

  useEffect(() => {
    groupsFetcher.load(path.to.api.groupsByType(innerProps.type));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          children: group.children,
        });

        const subgroups = group.children.map((subgroup) => ({
          ...subgroup.data,
          uid: getOptionId(groupId, subgroup.data.id),
          label: subgroup.data.name || "",
          children: subgroup.children,
        }));

        result.push(...subgroups);
      }

      const users = group.data.users.map((user) => {
        return {
          ...user,
          uid: getOptionId(groupId, user.id),
          label: user.fullName || "",
        };
      });

      result.push(...users);

      return result;
    };

    // TODO filter for employeeTypes only and allowedUsers

    return !groupsFetcher.data || !groupsFetcher.data.groups
      ? []
      : groupsFetcher.data.groups.reduce<OptionGroup[]>((acc, group) => {
          if (
            !innerProps.usersOnly ||
            (group.data.users && group.data.users.length)
          ) {
            const uid = getGroupId(instanceId, group.data.id);
            return acc.concat({
              uid,
              expanded: false,
              items: makeGroupItems(group as Group, uid),
              name: group.data.name || "",
            });
          }
          return acc;
        }, []);
  }, [groupsFetcher.data, innerProps.usersOnly, instanceId]);

  /* Pre-populate controlled component after data loads */
  useEffect(() => {
    if (innerProps.value && optionGroups && optionGroups.length > 0) {
      const flattened = optionGroups.reduce<IndividualOrGroup[]>(
        (acc, group) => acc.concat(group.items),
        []
      );
      if (Array.isArray(innerProps.value)) {
        const selections = flattened.reduce<SelectionItemsById>((acc, item) => {
          if (innerProps.value!.includes(item.id)) {
            return {
              ...acc,
              [item.id]: item,
            };
          }
          return acc;
        }, {});
        if (Object.keys(selections).length > 0) {
          setSelectionItemsById(selections);
        }
      } else {
        const selection = flattened.find(
          (item) => item.id === innerProps.value
        );
        if (selection) {
          setSelectionItemsById({
            [selection?.id]: selection,
          });
        }
      }
    }
  }, [optionGroups, innerProps.value]);

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
              items: matches,
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

  useEffect(() => {
    setFilteredOptionGroups(makeFilteredOptionGroups());
  }, [optionGroups, makeFilteredOptionGroups, setFilteredOptionGroups]);

  /* Event Handlers */

  const commit = useCallback(() => {
    dropdown.onClose();
    setFocusedId(null);
  }, [dropdown, setFocusedId]);

  useOutsideClick({
    ref: containerRef,
    handler: () => {
      clear();
      commit();
    },
  });

  const focusInput = useCallback(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

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

  const onGroupExpand = useCallback(
    (uid: string) =>
      setFilteredOptionGroups((previousGroups) =>
        previousGroups.map((group) =>
          group.uid === uid ? { ...group, expanded: true } : group
        )
      ),
    [setFilteredOptionGroups]
  );

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
      setFocusedId,
    ]
  );

  const debouncedInputChange = useMemo(() => {
    return debounce((search: string) => {
      setFilteredOptionGroups(makeFilteredOptionGroups(search));
      resetFocus();
    }, 240);
  }, [makeFilteredOptionGroups, resetFocus, setFilteredOptionGroups]);

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

  const onSelect = useCallback(
    (selectionItem?: IndividualOrGroup) => {
      if (selectionItem === undefined) return;
      setSelectionItemsById((previousSelections) => {
        const nextSelections = innerProps.isMulti
          ? {
              ...previousSelections,
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
      setSelectionItemsById,
    ]
  );

  const onDeselect = useCallback(
    (selectionItem: IndividualOrGroup) => {
      if (selectionItem === undefined) return;
      const { id } = selectionItem;
      setSelectionItemsById((previousSelections) => {
        if (id in previousSelections) {
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
          [selectionItem.id]: toggleChecked(selectionItem),
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
      setControlledValue,
    ]
  );

  const onExplode = useCallback(
    (selectionItem: IndividualOrGroup) => {
      if (!("users" in selectionItem)) return;

      const { id, users, children } = selectionItem;

      setSelectionItemsById((prevSelectionItems) => {
        if (id in prevSelectionItems) {
          const { [id]: removed, ...newSelectionItems } = prevSelectionItems;

          users.forEach((user) => {
            newSelectionItems[user.id] = {
              ...user,
              uid: getOptionId(id, user.id),
              label: user.fullName || "",
            };
          });

          children?.forEach((group) => {
            newSelectionItems[group.data.id] = {
              ...group.data,
              uid: getOptionId(id, group.data.id),
              label: group.data.name || "",
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
      setFocus,
    ]
  );

  /* Accessibility */

  const popoverProps = useMemo<AriaAttributes>(() => ({}), []);

  const listBoxProps = useMemo<AriaAttributes & { id: string }>(
    () => ({
      id: instanceId,
      role: "tree",
      tabIndex: -1,
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
      "aria-activedescendant": undefined, // TODO
      autoComplete: "off",
      autoCorrect: "off",
    }),
    [instanceId, dropdown.isOpen]
  );

  const aria = useMemo(
    () => ({
      inputProps,
      listBoxProps,
      popoverProps,
    }),
    [inputProps, listBoxProps, popoverProps]
  );

  let inputValue =
    innerProps.isMulti || focusedId || controlledValue
      ? controlledValue
      : Object.values(selectionItemsById)?.[0]?.label ?? "";

  return {
    aria,
    groups: filteredOptionGroups,
    errors: groupsFetcher.data?.errors,
    loading: groupsFetcher.state === "loading",
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
      focusableNodes,
    },
    // event handlers
    onClearInput,
    onKeyDown,
    onGroupCollapse,
    onGroupExpand,
    onInputChange,
    onInputBlur,
    onInputFocus,
    onSelect,
    onDeselect,
    onToggleChecked,
    onExplode,
    onMouseOver,
    setControlledValue,
    setSelectionItemsById,
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
    isChecked: true,
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
    isChecked: !item.isChecked || false,
  };
}

function makeSelectionItemsById(
  input: IndividualOrGroup[],
  isMulti: boolean
): SelectionItemsById {
  const result: SelectionItemsById = {};
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
