"use client";

import type { JSONContent, MentionSuggestion } from "@carbon/tiptap";
import {
  Command,
  createImageUpload,
  createMentionExtension,
  EditorBubble,
  EditorCommand,
  EditorCommandEmpty,
  EditorCommandItem,
  EditorCommandList,
  EditorContent,
  EditorRoot,
  handleCommandNavigation,
  handleImageDrop,
  handleImagePaste,
  ImageResizer,
  MergeTokenHighlight,
  Placeholder,
  renderItems
} from "@carbon/tiptap";
import TextStyle from "@tiptap/extension-text-style";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Separator } from "../Separator";
import { cn } from "../utils/cn";
import { ColorSelector } from "./components/ColorSelector";
import { LinkSelector } from "./components/LinkSelector";
import { Toolbar } from "./components/Toolbar";
import { DocumentTitle } from "./document-title";
import { defaultExtensions } from "./extensions";

const NodeSelector = lazy(() =>
  import("./components/NodeSelector").then((m) => ({ default: m.NodeSelector }))
);
const TextButtons = lazy(() =>
  import("./components/TextButton").then((m) => ({ default: m.TextButtons }))
);

interface MentionConfig {
  /**
   * Trigger character for this mention type (e.g., "@" for items)
   */
  char: string;
  /**
   * List of suggestions to show
   */
  items: MentionSuggestion[];
}

interface EditorProp {
  className?: string;
  initialValue?: JSONContent;
  onChange: (value: JSONContent) => void;
  onUpload?: (file: File) => Promise<string>;
  disableFileUpload?: boolean;
  /**
   * Optional mention configurations. Each config creates a mention extension
   * with a unique trigger character.
   * @example
   * mentions={[
   *   { char: "@", items: [{ id: "1", label: "Widget A" }] }
   * ]}
   */
  mentions?: MentionConfig[];
  /**
   * When provided, `{token}` merge fields are highlighted inline. Tokens in the
   * list render as known (blue); others render as unknown (red). Pass an empty
   * array to highlight every `{token}` as known.
   */
  highlightTokens?: string[];
  /**
   * Render a persistent formatting toolbar pinned to the top of the editor,
   * instead of relying solely on the floating bubble menu. Intended for
   * full-screen editors (procedures, training, quality documents); leave off
   * for card-contained editors like notes. The toolbar exposes the same
   * options as the bubble menu — no new capabilities.
   */
  toolbar?: boolean;
  /**
   * Full-screen "document" mode. When provided, the editor's first block is a
   * locked H1 title seeded from `title.value`; the title text is streamed back
   * through `title.onChange`, and `onChange` receives the body *without* the
   * title node (so `content` storage stays title-free). Also pads the content
   * and styles the title so the toolbar can sit flush. Leave undefined for
   * card-contained editors (notes, issues) — they are completely unaffected.
   */
  title?: {
    value: string;
    onChange: (title: string) => void;
    placeholder?: string;
  };
}

const defaultOnUpload = async (file: File) => {
  alert(
    "onUpload is not implemented. Please pass an onUpload function to the Editor. Trying to upload " +
      file.name
  );
};

const Editor = ({
  className,
  initialValue,
  onChange,
  onUpload,
  disableFileUpload,
  mentions,
  highlightTokens,
  toolbar,
  title
}: EditorProp) => {
  const titleMode = !!title;
  const titlePlaceholder = title?.placeholder ?? "Untitled";
  const [openNode, setOpenNode] = useState(false);
  const [openColor, setOpenColor] = useState(false);
  const [openLink, setOpenLink] = useState(false);
  const [suggestionItems, setSuggestionItems] = useState<any[]>([]);

  // Use a ref to hold the current mention items so the extension can access
  // the latest items without needing to be recreated
  const mentionItemsRef = useRef<MentionSuggestion[]>([]);
  if (mentions && mentions.length > 0) {
    mentionItemsRef.current = mentions[0]!.items;
  }

  const uploadFn = useMemo(() => {
    const uploadHandler = onUpload ? onUpload : defaultOnUpload;
    return createImageUpload({
      onUpload: uploadHandler,
      validateFn: (file) => {
        if (disableFileUpload) {
          toast.error("File upload is not supported for external scars");
          return false;
        }
        if (!file.type.includes("image/")) {
          toast.error(`File type ${file.type} not supported.`);
          return false;
        } else if (file.size / 1024 / 1024 > 20) {
          toast.error("File size too big (max 20MB).");
          return false;
        }
        return true;
      }
    });
  }, [onUpload, disableFileUpload]);

  useEffect(() => {
    let cancelled = false;
    import("./slash").then((m) => {
      if (cancelled) return;
      setSuggestionItems(m.getSuggestionItems(uploadFn));
    });
    return () => {
      cancelled = true;
    };
  }, [uploadFn]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const mentionExtension = useMemo(() => {
    if (!mentions || mentions.length === 0) return null;
    // Use the first mention config - if multiple are needed with different
    // trigger characters, this would need to be extended
    const config = mentions[0]!;
    return createMentionExtension({
      name: "mention",
      char: config.char,
      // Pass a getter function so the extension always gets the latest items
      items: () => mentionItemsRef.current
    });
    // Only depend on mentions existence and char, not items content
  }, [mentions?.[0]?.char]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: key on token list, not identity
  const tokenHighlightExtension = useMemo(
    () =>
      highlightTokens
        ? MergeTokenHighlight.configure({ knownTokens: highlightTokens })
        : null,
    [highlightTokens?.join(" ")]
  );

  const extensions = useMemo(() => {
    // In title mode, swap the default placeholder for one that labels the
    // locked first block "Untitled", and add the title-lock extension.
    const base = titleMode
      ? [
          ...defaultExtensions.filter(
            (ext) => (ext as { name?: string }).name !== "placeholder"
          ),
          Placeholder.configure({
            placeholder: ({ node, pos }: { node: any; pos: number }) => {
              if (pos === 0) return titlePlaceholder;
              if (node.type.name === "heading") {
                return `Heading ${node.attrs.level}`;
              }
              return "Press '/' for commands";
            },
            includeChildren: true
          }),
          DocumentTitle
        ]
      : defaultExtensions;

    return [
      ...base,
      TextStyle,
      Command.configure({
        suggestion: {
          items: () => suggestionItems,
          render: renderItems
        } as any
      }),
      ...(mentionExtension ? [mentionExtension] : []),
      ...(tokenHighlightExtension ? [tokenHighlightExtension] : [])
    ];
  }, [
    suggestionItems,
    mentionExtension,
    tokenHighlightExtension,
    titleMode,
    titlePlaceholder
  ]);

  // Seed the editor once. In title mode the document is composed as
  // [locked H1 title, ...body]; the title value is only used for this initial
  // seed (subsequent edits stream out via title.onChange).
  const initialContentRef = useRef<JSONContent | undefined>(undefined);
  if (initialContentRef.current === undefined) {
    if (titleMode) {
      const titleValue = title?.value ?? "";
      initialContentRef.current = {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            ...(titleValue
              ? { content: [{ type: "text", text: titleValue }] }
              : {})
          },
          ...(initialValue?.content ?? [])
        ]
      };
    } else {
      initialContentRef.current = initialValue;
    }
  }

  return (
    <EditorRoot>
      <EditorContent
        className={cn(
          "[&_.is-empty]:text-muted-foreground",
          titleMode && "has-document-title",
          className
        )}
        {...(initialContentRef.current && {
          initialContent: initialContentRef.current
        })}
        extensions={extensions}
        editorProps={{
          handleDOMEvents: {
            keydown: (_view, event) => handleCommandNavigation(event)
          },
          handlePaste: (view, event) => handleImagePaste(view, event, uploadFn),
          handleDrop: (view, event, _slice, moved) =>
            handleImageDrop(view, event, moved, uploadFn),
          attributes: {
            class: cn(
              "prose dark:prose-invert focus:outline-none max-w-full",
              // Flush toolbar: pad the content, not the toolbar, and leave a
              // gap below the sticky toolbar.
              titleMode && "px-8 pt-6 pb-24"
            )
          }
        }}
        onUpdate={({ editor }) => {
          if (title) {
            const json = editor.getJSON();
            const [, ...body] = json.content ?? [];
            title.onChange(editor.state.doc.firstChild?.textContent ?? "");
            onChange({ type: "doc", content: body });
          } else {
            onChange(editor.getJSON());
          }
        }}
        slotBefore={toolbar ? <Toolbar /> : undefined}
        slotAfter={<ImageResizer />}
      >
        <EditorCommand className="z-50 h-auto max-h-[330px] overflow-y-auto rounded-md border border-muted bg-background px-1 py-2 shadow-md transition-[opacity,transform]">
          <EditorCommandEmpty className="px-2 text-muted-foreground">
            No results
          </EditorCommandEmpty>
          <EditorCommandList>
            {suggestionItems.map((item) => (
              <EditorCommandItem
                value={item.title}
                onCommand={(val) => item.command?.(val)}
                className={`flex w-full items-center space-x-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent aria-selected:bg-accent `}
                key={item.title}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-md border border-muted bg-background">
                  {item.icon}
                </div>
                <div>
                  <p className="font-medium">{item.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.description}
                  </p>
                </div>
              </EditorCommandItem>
            ))}
          </EditorCommandList>
        </EditorCommand>

        <EditorBubble
          tippyOptions={{
            placement: "top"
          }}
          className="flex w-fit max-w-[90vw] overflow-hidden rounded-md border border-muted bg-card shadow-xl p-2"
        >
          <Separator orientation="vertical" />
          <Suspense fallback={null}>
            <NodeSelector open={openNode} onOpenChange={setOpenNode} />
          </Suspense>
          <Separator orientation="vertical" />

          <LinkSelector open={openLink} onOpenChange={setOpenLink} />
          <Separator orientation="vertical" />
          <Suspense fallback={null}>
            <TextButtons />
          </Suspense>
          <Separator orientation="vertical" />
          <ColorSelector open={openColor} onOpenChange={setOpenColor} />
        </EditorBubble>
      </EditorContent>
    </EditorRoot>
  );
};

export default Editor;
