import type {
  ChangeEvent,
  HTMLAttributes,
  InputHTMLAttributes,
  KeyboardEvent,
  MutableRefObject,
  ReactNode,
  RefObject
} from "react";

import type { User, UserSelectGroup } from "~/modules/users";

export type ComboBoxRefs = {
  containerRef: RefObject<HTMLDivElement>;
  inputRef: RefObject<HTMLInputElement>;
  listBoxRef: RefObject<HTMLDivElement>;
  popoverRef: RefObject<HTMLDivElement>;
  buttonRef: RefObject<Element>;
  focusableNodes: MutableRefObject<Record<string, TreeNode>>;
};

export interface UserSelectProps {
  alwaysSelected?: string[];
  accessibilityLabel?: string;
  checkedSelections?: boolean;
  className?: string;
  disabled?: boolean;
  hideSelections?: boolean;
  id?: string;
  innerInputRender?:
    | ((props: UserSelectProps) => JSX.Element | JSX.Element[])
    | ReactNode
    | null;
  isMulti?: boolean;
  label?: string;
  isOptional?: boolean;
  placeholder?: string;
  showAvatars?: boolean;
  queryFilters?: UserSelectionGenericQueryFilters;
  readOnly?: boolean;
  renderInput?: ReactNode;
  resetAfterSelection?: boolean;
  selections?: IndividualOrGroup[];
  selectionsMaxHeight?: string | number;
  type?: "employee" | "supplier" | "customer";
  usersOnly?: boolean;
  value?: string[] | string; // Will be set when used as a controlled input
  width?: number;
  onBlur?: (e: any) => void;
  onCancel?: () => void;
  onChange?: (selectionsList: IndividualOrGroup[]) => void;
  onCheckedSelectionsChange?: (
    checkedSelectionsList: IndividualOrGroup[]
  ) => void;
}

export type TreeNode = {
  uid: string;
  expandable: boolean;
  parentId?: string;
  previousId?: string;
  nextId?: string;
};

interface SelectionOptions {
  uid: string;
  label: string;
  isChecked?: boolean;
  isPersistent?: boolean;
}

export type UserWithOptions = User & SelectionOptions;

/**
 * A selected (or selectable) group. `users` is always present — it is the
 * discriminator between users and groups ("users" in item) relied on by the
 * Form wrappers — but stays [] until the group is exploded.
 */
export type SelectionGroupWithOptions = UserSelectGroup & {
  users: User[];
  memberCount: number;
} & SelectionOptions;

export type IndividualOrGroup = UserWithOptions | SelectionGroupWithOptions;

export type SelectionItemsById = Record<string, IndividualOrGroup>;

/** One group node in the lazily-loaded browse tree. */
export type GroupNode = {
  /** Path-scoped id: `${parentUid}_${groupId}_group` — unique per tree path. */
  uid: string;
  group: UserSelectGroup;
  expanded: boolean;
  loading: boolean;
  /** null until the group's direct members have been fetched. */
  members: { groups: GroupNode[]; users: UserWithOptions[] } | null;
};

export type UserSelectViewModel =
  | {
      mode: "browse";
      nodes: GroupNode[];
      hasMore: boolean;
      loadingMore: boolean;
    }
  | {
      mode: "search";
      groups: SelectionGroupWithOptions[];
      users: UserWithOptions[];
      searching: boolean;
    };

export interface SelectInputProps {
  aria?: Omit<InputHTMLAttributes<HTMLInputElement>, "size">;
  inputValue: string;
  innerProps: UserSelectProps;
  loading: boolean;
  isMulti: boolean;
  refs: ComboBoxRefs;
  onClearSearchInput: () => void;
  onInputOnChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onInputKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onInputBlur: () => void;
  onInputFocus: () => void;
}

export interface PopoverProps {
  aria: HTMLAttributes<HTMLDivElement>;
  children: ReactNode;
  innerProps: UserSelectProps;
  refs: ComboBoxRefs;
}

export interface UserSelectionGenericQueryFilters {
  excludeSelf?: boolean;
  onlyEmployeeTypes?: string[];
  allowedIds?: string[];
}
