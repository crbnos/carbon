import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

/**
 * Locks the document's first node as an H1 "title": it can't be deleted, merged
 * into, or turned into another block type, and pressing Enter inside it drops
 * the cursor into the body rather than splitting the title.
 *
 * Modeled on Plane's document title behavior, but as a single-editor extension
 * (Carbon stores `name`/`content` separately and has no Yjs, so the consuming
 * component splits the title node out of the body on save).
 *
 * Only added when the `Editor` runs in title mode — every other editor keeps the
 * default schema and behavior.
 */
export const DocumentTitle = Extension.create({
  name: "documentTitle",
  // Run our Backspace/Enter handlers before StarterKit's defaults.
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { state } = this.editor;
        const { $from, empty } = state.selection;
        // At the very start of the title, swallow Backspace so the title can
        // never be deleted or have the body merged up into it.
        if (
          empty &&
          $from.parent === state.doc.firstChild &&
          $from.parentOffset === 0
        ) {
          return true;
        }
        return false;
      },
      Enter: () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        // Enter anywhere in the title moves into the body (creating a first
        // paragraph if the body is empty) — never a second title line.
        if ($from.parent !== state.doc.firstChild) return false;

        const titleNode = state.doc.firstChild;
        if (!titleNode) return false;
        const afterTitle = titleNode.nodeSize; // position just after the title
        const hasBody = !!state.doc.maybeChild(1);

        if (hasBody) {
          return this.editor
            .chain()
            .focus(afterTitle + 1)
            .run();
        }
        return this.editor
          .chain()
          .insertContentAt(afterTitle, { type: "paragraph" })
          .focus(afterTitle + 1)
          .run();
      }
    };
  },

  addProseMirrorPlugins() {
    const headingType = this.editor.schema.nodes.heading;
    if (!headingType) return [];

    return [
      new Plugin({
        key: new PluginKey("documentTitleLock"),
        // Coerce node 0 back to an H1 after any transaction that changed it
        // (e.g. the block-type dropdown turning it into a paragraph or H2).
        appendTransaction: (_transactions, _oldState, newState) => {
          const first = newState.doc.firstChild;
          if (!first || !first.isTextblock) return null;
          const isTitle =
            first.type.name === "heading" && first.attrs.level === 1;
          if (isTitle) return null;
          const tr = newState.tr.setNodeMarkup(0, headingType, {
            ...first.attrs,
            level: 1
          });
          return tr.steps.length ? tr : null;
        }
      })
    ];
  }
});
