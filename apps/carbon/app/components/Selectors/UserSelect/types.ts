import type {
  ChangeEvent,
  HTMLAttributes,
  InputHTMLAttributes,
  KeyboardEvent,
  MutableRefObject,
  ReactNode,
  RefObject,
} from "react";

import type { Group, User } from "~/modules/users";

export type ComboBoxRefs = {
  containerRef: RefObject<HTMLDivElement>;
  inputRef: RefObject<HTMLInputElement>;
  listBoxRef: RefObject<HTMLUListElement>;
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

export type OptionGroup = {
  uid: string;
  expanded: boolean;
  items: IndividualOrGroup[];
  name: string;
};

export type TreeNode = {
  uid: string;
  expandable: boolean;
  parentId?: string;
  previousId?: string;
  nextId?: string;
};
export interface PopoverProps {
  aria: HTMLAttributes<HTMLDivElement>;
  children: ReactNode;
  innerProps: UserSelectProps;
  refs: ComboBoxRefs;
}

interface SelectionOptions {
  uid: string;
  label: string;
  isChecked?: boolean;
  isPersistent?: boolean;
}

type UserWithOptions = User & SelectionOptions;
type SelectionGroupWithOptions = Group["data"] & {
  children?: Group[];
} & SelectionOptions;

export type IndividualOrGroup = UserWithOptions | SelectionGroupWithOptions;

export type SelectionItemsById = Record<string, IndividualOrGroup>;

export interface SelectInputProps {
  aria?: Omit<InputHTMLAttributes<HTMLInputElement>, "size">;
  errors?: unknown; // TODO
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

export interface UserTreeSelectProps {
  aria: HTMLAttributes<HTMLUListElement>;
  disabledSelections?: string[];
  focusedId: string | null;
  groups: OptionGroup[];
  groupTypeFilter?: string;
  innerProps: UserSelectProps;
  instanceId: string;
  itemOnSelect?: (selectableItem: IndividualOrGroup) => void;
  itemOnStage?: (selectableItem: IndividualOrGroup) => void;
  loading: boolean;
  multi?: boolean;
  refs: ComboBoxRefs;
  searchFilter?: string;
  selectionItemsById: SelectionItemsById;
  stagedSelectionsById?: SelectionItemsById;
  visible?: boolean;
}

export interface UserSelectionGenericQueryFilters {
  excludeSelf?: boolean;
  onlyEmployeeTypes?: string[];
  allowedIds?: string[];
}
