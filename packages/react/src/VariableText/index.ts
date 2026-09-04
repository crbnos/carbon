// The menu contract, re-exported so a consumer can write a `menuComponent` without
// depending on the editor package directly.
export type {
  MentionListComponent as VariableTextMenuComponent,
  MentionListProps as VariableTextMenuProps,
  MentionListRef as VariableTextMenuHandle
} from "@carbon/tiptap";
// The token's pill styling, so a chip drawn outside the editor matches the one inside it.
export { MENTION_CHIP_TONE_CLASS as VARIABLE_TEXT_CHIP_CLASS } from "@carbon/tiptap";
export type {
  VariableTextHandle,
  VariableTextPart,
  VariableTextProps,
  VariableTextSuggestion,
  VariableTextToken
} from "./VariableText";
export { VARIABLE_TEXT_SHELL_CLASS, VariableText } from "./VariableText";
