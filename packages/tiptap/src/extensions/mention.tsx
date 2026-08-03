import type {
  MentionNodeAttrs,
  MentionOptions
} from "@tiptap/extension-mention";
import Mention from "@tiptap/extension-mention";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { ReactRenderer } from "@tiptap/react";
import type {
  SuggestionKeyDownProps,
  SuggestionProps
} from "@tiptap/suggestion";
import type { RefObject } from "react";
import tippy, { type Instance, type Props } from "tippy.js";
import type { MentionListRef } from "../components/mention-list";
import { MentionList } from "../components/mention-list";

export interface MentionSuggestion {
  id: string;
  label: string;
  helper?: string;
}

export interface CreateMentionSuggestionOptions {
  /**
   * The trigger character for this mention type (e.g., "@" for users, "#" for tags)
   */
  char: string;
  /**
   * The list of suggestions to show, or a function that returns them
   */
  items: MentionSuggestion[] | (() => MentionSuggestion[]);
  /**
   * Optional ref to the element to append the popup to
   */
  elementRef?: RefObject<Element> | null;
  /**
   * Overrides the default prefix match. Use for substring or fuzzy matching.
   */
  filter?: (item: MentionSuggestion, query: string) => boolean;
  /**
   * What may precede the trigger character. `@tiptap/suggestion` defaults to
   * `[" "]`, so the trigger is ignored mid-word; pass `null` to allow it anywhere.
   */
  allowedPrefixes?: string[] | null;
  /**
   * Fires when the popup opens and closes. The host needs this to stop competing
   * for keys — ProseMirror consults `editorProps.handleKeyDown` before plugins,
   * so a host that swallows Enter would swallow the popup's Enter too.
   */
  onActiveChange?: (active: boolean) => void;
}

const startsWithQuery = (item: MentionSuggestion, query: string) =>
  item.label.toLowerCase().startsWith(query.toLowerCase());

export function createMentionSuggestion({
  char,
  items,
  elementRef,
  filter,
  allowedPrefixes,
  onActiveChange
}: CreateMentionSuggestionOptions): MentionOptions["suggestion"] {
  const match = filter ?? startsWithQuery;
  return {
    char,
    ...(allowedPrefixes !== undefined && { allowedPrefixes }),
    items: ({ query }) => {
      const itemList = typeof items === "function" ? items() : items;
      return itemList.filter((item) => match(item, query));
    },
    render: () => {
      let component: ReactRenderer<MentionListRef> | null = null;
      let popup: Instance<Props>[] | null = null;

      return {
        onStart: (props: SuggestionProps<MentionSuggestion>) => {
          onActiveChange?.(true);
          component = new ReactRenderer(MentionList, {
            props,
            editor: props.editor
          });

          if (!props.clientRect) {
            return;
          }

          popup = tippy("body", {
            getReferenceClientRect: props.clientRect as () => DOMRect,
            appendTo: () => elementRef?.current ?? document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: "manual",
            placement: "bottom-start"
          });
        },

        onUpdate(props: SuggestionProps<MentionSuggestion>) {
          component?.updateProps(props);

          if (!props.clientRect) {
            return;
          }

          popup?.[0]?.setProps({
            getReferenceClientRect: props.clientRect as () => DOMRect
          });
        },

        onKeyDown(props: SuggestionKeyDownProps) {
          if (props.event.key === "Escape") {
            popup?.[0]?.hide();
            return true;
          }

          return component?.ref?.onKeyDown(props) ?? false;
        },

        onExit() {
          onActiveChange?.(false);
          popup?.[0]?.destroy();
          component?.destroy();
        }
      };
    }
  };
}

export interface CreateMentionExtensionOptions {
  /**
   * A unique name for this mention extension (e.g., "item-mention", "customer-mention")
   */
  name: string;
  /**
   * The trigger character for this mention type
   */
  char: string;
  /**
   * The list of suggestions, or a function that returns them
   */
  items: MentionSuggestion[] | (() => MentionSuggestion[]);
  /**
   * Optional ref to append popup to
   */
  elementRef?: RefObject<Element> | null;
  /**
   * Overrides the default prefix match. Use for substring or fuzzy matching.
   */
  filter?: (item: MentionSuggestion, query: string) => boolean;
  /**
   * Overrides the text shown inside the chip. Defaults to the trigger char
   * followed by the label, which is TipTap's own default.
   */
  renderLabel?: (attrs: { id: string | null; label?: string | null }) => string;
  /** See `CreateMentionSuggestionOptions`. */
  allowedPrefixes?: string[] | null;
  /** See `CreateMentionSuggestionOptions`. */
  onActiveChange?: (active: boolean) => void;
}

/** The chip styling, exported so a non-editable rendition of the same token matches. */
export const MENTION_CHIP_CLASS =
  "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-400";

/**
 * Creates a configured mention extension for a specific type of mention.
 *
 * @example
 * // Create an items mention with @ trigger
 * const ItemMention = createMentionExtension({
 *   name: "item-mention",
 *   char: "@",
 *   items: [
 *     { id: "1", label: "Widget A" },
 *     { id: "2", label: "Widget B" },
 *   ],
 * });
 *
 * @example
 * // Create a customer mention with # trigger
 * const CustomerMention = createMentionExtension({
 *   name: "customer-mention",
 *   char: "#",
 *   items: [
 *     { id: "c1", label: "Acme Corp" },
 *     { id: "c2", label: "Global Inc" },
 *   ],
 * });
 */
export function createMentionExtension({
  name,
  char,
  items,
  elementRef,
  filter,
  renderLabel,
  allowedPrefixes,
  onActiveChange
}: CreateMentionExtensionOptions) {
  const text = renderLabel
    ? ({ node }: { node: ProseMirrorNode }) =>
        renderLabel(node.attrs as MentionNodeAttrs)
    : undefined;

  return Mention.configure({
    HTMLAttributes: {
      class: MENTION_CHIP_CLASS,
      "data-mention-type": name
    },
    suggestion: createMentionSuggestion({
      char,
      items,
      elementRef,
      filter,
      allowedPrefixes,
      onActiveChange
    }),
    ...(text && {
      renderText: text,
      renderHTML: ({ node, options }) => [
        "span",
        options.HTMLAttributes,
        text({ node })
      ]
    })
  }).extend({
    name
  });
}

export { Mention };
