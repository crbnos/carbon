// The menu contract, re-exported so a consumer can write a `menuComponent` without
// depending on the editor package directly.
export type {
  MentionListComponent as VariableTextMenuComponent,
  MentionListProps as VariableTextMenuProps,
  MentionListRef as VariableTextMenuHandle
} from "@carbon/tiptap";
export type {
  VariableTextHandle,
  VariableTextPart,
  VariableTextProps,
  VariableTextSuggestion,
  VariableTextToken
} from "./VariableText";
export { VARIABLE_TEXT_SHELL_CLASS, VariableText } from "./VariableText";
