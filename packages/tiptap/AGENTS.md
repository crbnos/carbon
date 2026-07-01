# @carbon/tiptap

Rich text editor — TipTap extensions, editor components, image handling plugins, and mention support.

## Always

- **Use the barrel export** (`@carbon/tiptap`) for all imports — components, extensions, plugins, and utils are all exported from `src/index.ts`.
- **Follow the component composition pattern**: `EditorRoot` > `EditorContent` with extensions array. Use `EditorBubble`/`EditorBubbleItem` for floating toolbars, `EditorCommand`/`EditorCommandItem` for slash commands.
- **Extensions live in `src/extensions/`**, components in `src/components/`. Add new TipTap extensions to `src/extensions/index.ts` barrel.
- **Image uploads use the plugin system** — `createImageUpload`, `handleImageDrop`, `handleImagePaste` from `src/plugins/`.

## Ask First

- Adding new TipTap extension dependencies (check compatibility with existing extensions)
- Changing the `EditorContent` or `EditorRoot` component APIs
- Modifying mention or slash-command suggestion behavior

## Never

- Import TipTap dependencies directly in app code — use re-exports from `@carbon/tiptap`
- Modify `@tiptap/core` or `@tiptap/pm` internals directly — use the extension API

## Validation Commands

```bash
pnpm --filter @carbon/tiptap typecheck
pnpm --filter @carbon/tiptap lint
```

## Key Exports

**Components**: `EditorRoot`, `EditorContent`, `EditorBubble`, `EditorBubbleItem`, `EditorCommand`, `EditorCommandItem`, `EditorCommandList`, `MentionList`, `useEditor`

**Extensions**: `StarterKit`, `Placeholder`, `TiptapLink`, `TiptapImage`, `TiptapUnderline`, `Color`, `TextStyle`, `HighlightExtension`, `TaskList`, `TaskItem`, `CodeBlockLowlight`, `HorizontalRule`, `Youtube`, `CustomKeymap`, `GlobalDragHandle`, `AIHighlight`, `MergeTokenHighlight`, `MarkdownExtension`, `Mention`, `createMentionExtension`, `createMentionSuggestion`

**Plugins**: `UploadImagesPlugin`, `createImageUpload`, `handleImageDrop`, `handleImagePaste`

**Utils**: `getPrevText`, `getAllContent`, `isValidUrl`, `getUrlFromString`

## Cross-References

- `@carbon/react` — wraps TipTap in `Editor/` and `RichText/` sub-exports
- Uses `jotai` for editor state atoms (`queryAtom`, `rangeAtom`)
- Uses `cmdk` for slash-command UI
