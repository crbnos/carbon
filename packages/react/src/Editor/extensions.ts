import { Extension, Node } from "@tiptap/core";
import Table from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { cx } from "class-variance-authority";
import {
  AIHighlight,
  HorizontalRule,
  Placeholder,
  StarterKit,
  TaskItem,
  TaskList,
  TiptapImage,
  TiptapLink,
  UpdatedImage,
} from "novel/extensions";
import { UploadImagesPlugin } from "novel/plugins";

// Video regex patterns
const LOOM_REGEX = /https:\/\/www\.loom\.com\/share\/([a-zA-Z0-9]+)/;
const YOUTUBE_REGEX =
  /https:\/\/(?:www\.youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9]+)/;

// Custom node for HTML content
const HTMLContent = Node.create({
  name: "htmlContent",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      html: {
        default: "",
      },
      type: {
        default: "loom", // or "youtube"
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-video-embed]",
      },
    ];
  },

  renderHTML({ node }) {
    const container = document.createElement("div");
    container.setAttribute("data-video-embed", node.attrs.type);
    container.setAttribute("tabindex", "0");
    container.className =
      "focus:ring-2 focus:ring-primary hover:bg-zinc-200 dark:hover:bg-zinc-800 p-2 border bg-zinc-100 dark:bg-zinc-900 cursor-move rounded-lg";
    container.innerHTML = node.attrs.html;
    return container;
  },
});

const VideoEmbed = Extension.create({
  name: "videoEmbed",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("videoEmbed"),
        props: {
          handlePaste: (view, event) => {
            const text = event.clipboardData?.getData("text/plain");
            if (!text) return false;

            const loomMatch = text.match(LOOM_REGEX);
            const youtubeMatch = text.match(YOUTUBE_REGEX);

            if (!loomMatch && !youtubeMatch) return false;

            let embedHtml = "";
            let videoType = "";

            if (loomMatch) {
              const [, videoId] = loomMatch;
              videoType = "loom";
              embedHtml = `<div><div style="position: relative; padding-bottom: 62.5%; height: 0;"><iframe src="https://www.loom.com/embed/${videoId}" frameborder="0" webkitallowfullscreen mozallowfullscreen allowfullscreen style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;"></iframe></div></div>`;
            } else if (youtubeMatch) {
              const [, videoId] = youtubeMatch;
              videoType = "youtube";
              embedHtml = `<div><div style="position: relative; padding-bottom: 56.25%; height: 0;"><iframe src="https://www.youtube.com/embed/${videoId}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;"></iframe></div></div>`;
            }

            // Create an HTML content node
            const node = view.state.schema.nodes.htmlContent.create({
              html: embedHtml,
              type: videoType,
            });
            const transaction = view.state.tr.replaceSelectionWith(node);
            view.dispatch(transaction);

            return true;
          },
          handleKeyDown: (view, event) => {
            // Handle delete/backspace when embed is selected
            if (
              (event.key === "Delete" || event.key === "Backspace") &&
              view.state.selection.empty
            ) {
              const $pos = view.state.selection.$from;
              const node = $pos.parent.maybeChild($pos.index());
              if (node && node.type.name === "htmlContent") {
                view.dispatch(
                  view.state.tr.delete(
                    $pos.pos - $pos.parentOffset,
                    $pos.pos - $pos.parentOffset + node.nodeSize
                  )
                );
                return true;
              }
            }
            return false;
          },
        },
      }),
    ];
  },
});

const aiHighlight = AIHighlight;
const placeholder = Placeholder;
const tiptapLink = TiptapLink.configure({
  HTMLAttributes: {
    class: cx(
      "text-muted-foreground underline underline-offset-[3px] hover:text-primary transition-colors cursor-pointer"
    ),
  },
});

const tiptapImage = TiptapImage.extend({
  addProseMirrorPlugins() {
    return [
      UploadImagesPlugin({
        imageClass: cx("opacity-40 rounded-lg border border-stone-200"),
      }),
    ];
  },
}).configure({
  allowBase64: true,
  HTMLAttributes: {
    class: cx("rounded-lg border border-muted"),
  },
});

const updatedImage = UpdatedImage.configure({
  HTMLAttributes: {
    class: cx("rounded-lg border border-muted"),
  },
});

const taskList = TaskList.configure({
  HTMLAttributes: {
    class: cx("not-prose pl-2 "),
  },
});
const taskItem = TaskItem.configure({
  HTMLAttributes: {
    class: cx("flex gap-2 items-start my-4"),
  },
  nested: true,
});

const horizontalRule = HorizontalRule.configure({
  HTMLAttributes: {
    class: cx("mt-4 mb-6 border-t border-muted-foreground"),
  },
});

const starterKit = StarterKit.configure({
  bulletList: {
    HTMLAttributes: {
      class: cx("list-disc list-outside leading-3 -mt-2"),
    },
  },
  orderedList: {
    HTMLAttributes: {
      class: cx("list-decimal list-outside leading-3 -mt-2"),
    },
  },
  listItem: {
    HTMLAttributes: {
      class: cx("leading-normal -mb-2"),
    },
  },
  blockquote: {
    HTMLAttributes: {
      class: cx("border-l-4 border-primary"),
    },
  },
  codeBlock: {
    HTMLAttributes: {
      class: cx(
        "rounded-md bg-muted text-muted-foreground border p-5 font-mono font-medium"
      ),
    },
  },
  code: {
    HTMLAttributes: {
      class: cx("rounded-md bg-muted  px-1.5 py-1 font-mono font-medium"),
      spellcheck: "false",
    },
  },
  horizontalRule: false,
  dropcursor: {
    color: "#DBEAFE",
    width: 4,
  },
  gapcursor: false,
});

export const defaultExtensions = [
  starterKit,
  placeholder,
  tiptapLink,
  tiptapImage,
  updatedImage,
  taskList,
  taskItem,
  horizontalRule,
  aiHighlight,
  VideoEmbed,
  HTMLContent,
  Table,
  TableCell,
  TableHeader,
  TableRow,
];
