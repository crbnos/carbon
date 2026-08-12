import type {
  MentionNodeAttrs,
  MentionOptions
} from "@tiptap/extension-mention";
import Mention from "@tiptap/extension-mention";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { ReactNodeViewProps } from "@tiptap/react";
import { ReactNodeViewRenderer, ReactRenderer } from "@tiptap/react";
import type {
  SuggestionKeyDownProps,
  SuggestionProps
} from "@tiptap/suggestion";
import type { ComponentType, RefAttributes, RefObject } from "react";
import tippy, { type Instance, type Props } from "tippy.js";
import type {
  MentionListProps,
  MentionListRef
} from "../components/mention-list";
import { MentionList } from "../components/mention-list";

export interface MentionSuggestion {
  id: string;
  label: string;
  helper?: string;
}

/**
 * A drop-in replacement for `MentionList`. Must forward a `MentionListRef` so the
 * suggestion plugin can delegate key handling to it.
 */
export type MentionListComponent = ComponentType<
  MentionListProps & RefAttributes<MentionListRef>
>;

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
  /**
   * Renders the popup instead of the built-in `MentionList`. Use when the host needs its own
   * list behaviour (grouping, drill-down, its own search). Defaults to `MentionList`.
   */
  listComponent?: MentionListComponent;
}

const startsWithQuery = (item: MentionSuggestion, query: string) =>
  item.label.toLowerCase().startsWith(query.toLowerCase());

export function createMentionSuggestion({
  char,
  items,
  elementRef,
  filter,
  allowedPrefixes,
  onActiveChange,
  listComponent
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
          component = new ReactRenderer(listComponent ?? MentionList, {
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
  /**
   * Renders the popup instead of the built-in `MentionList`. Use when the host needs its own
   * list behaviour (grouping, drill-down, its own search). Defaults to `MentionList`.
   */
  listComponent?: MentionListComponent;
  /**
   * Draws the chip itself as a React node view instead of static markup. Use when it
   * needs behaviour — a tooltip for a truncated label, say.
   */
  chipComponent?: ComponentType<ReactNodeViewProps>;
}

/** Colour and shape alone, for a chip that lays its own contents out. */
export const MENTION_CHIP_TONE_CLASS =
  "rounded-full px-1.5 py-0 text-[0.8125rem] font-medium leading-5 bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-400";

/** The same pill for a token that no longer points at anything. */
export const MENTION_CHIP_INVALID_TONE_CLASS =
  "rounded-full px-1.5 py-0 text-[0.8125rem] font-medium leading-5 bg-destructive text-destructive-foreground";

/**
 * The chip styling, exported so a non-editable rendition of the same token matches.
 * `inline-block`, not `inline-flex` — `text-overflow: ellipsis` never applies to a flex
 * container's anonymous item, so a long label used to overflow onto the line below.
 */
export const MENTION_CHIP_CLASS = `inline-block max-w-[14rem] overflow-hidden text-ellipsis whitespace-nowrap align-middle ${MENTION_CHIP_TONE_CLASS}`;

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
  onActiveChange,
  listComponent,
  chipComponent
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
      onActiveChange,
      listComponent
    }),
    ...(text && {
      renderText: text,
      renderHTML: ({ node, options }) => [
        "span",
        { ...options.HTMLAttributes },
        text({ node })
      ]
    })
  }).extend({
    name,
    // The base extension declares `id` and `label` only; an undeclared attribute is
    // dropped on the way into the document.
    addAttributes() {
      return {
        ...this.parent?.(),
        invalid: {
          default: false,
          parseHTML: (element) =>
            element.getAttribute("data-invalid") === "true",
          renderHTML: (attributes) =>
            attributes.invalid ? { "data-invalid": "true" } : {}
        }
      };
    },
    // `as: "span"` — the default container is a div, which would break the line inside
    // the paragraph the chip sits in.
    ...(chipComponent && {
      addNodeView: () => ReactNodeViewRenderer(chipComponent, { as: "span" })
    })
  });
}

export { Mention };
