import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

/**
 * Locks the document's first node as an H1 "title": it can't be deleted, merged
 * into (from either direction), or turned into another block type, and pressing
 * Enter inside it drops the cursor into the body rather than splitting the title.
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
  // Run our Backspace/Delete/Enter handlers before StarterKit's defaults.
  priority: 1000,

  addKeyboardShortcuts() {
    // The title is always the first top-level node.
    const atTitleStart = () => {
      const { $from, empty } = this.editor.state.selection;
      return (
        empty &&
        $from.parent === this.editor.state.doc.firstChild &&
        $from.parentOffset === 0
      );
    };
    const atTitleEnd = () => {
      const { $from, empty } = this.editor.state.selection;
      const first = this.editor.state.doc.firstChild;
      return (
        empty &&
        !!first &&
        $from.parent === first &&
        $from.parentOffset === first.content.size
      );
    };
    const atBodyStart = () => {
      const { $from, empty } = this.editor.state.selection;
      const second = this.editor.state.doc.maybeChild(1);
      return (
        empty && !!second && $from.parent === second && $from.parentOffset === 0
      );
    };
    // Move the cursor to the end of the title's text (never merging content).
    const focusTitleEnd = () => {
      const first = this.editor.state.doc.firstChild;
      if (!first) return false;
      return this.editor
        .chain()
        .focus(first.nodeSize - 1)
        .run();
    };

    // Backspace at the very start of the title, and at the start of the body,
    // must never join the two nodes together.
    const guardBackspace = () => {
      if (atTitleStart()) return true;
      if (atBodyStart()) return focusTitleEnd();
      return false;
    };
    // Delete/forward-delete at the end of the title must not pull the body up
    // into the heading.
    const guardDelete = () => {
      if (!atTitleEnd()) return false;
      const first = this.editor.state.doc.firstChild;
      if (!first) return false;
      const hasBody = !!this.editor.state.doc.maybeChild(1);
      if (!hasBody) return true; // nothing after the title — swallow
      return this.editor
        .chain()
        .focus(first.nodeSize + 1)
        .run();
    };

    return {
      Backspace: guardBackspace,
      "Mod-Backspace": guardBackspace,
      Delete: guardDelete,
      "Mod-Delete": guardDelete,
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
        // Coerce node 0 back to an H1 after any transaction that changed it —
        // the block-type dropdown turning it into a paragraph/H2 (a textblock,
        // preserve inline marks), or into a list/blockquote (not a textblock,
        // rebuild from its text so the schema stays valid).
        appendTransaction: (_transactions, _oldState, newState) => {
          const first = newState.doc.firstChild;
          if (!first) return null;
          const isTitle =
            first.type.name === "heading" && first.attrs.level === 1;
          if (isTitle) return null;

          const tr = newState.tr;
          if (first.isTextblock) {
            tr.setNodeMarkup(0, headingType, { ...first.attrs, level: 1 });
          } else {
            const text = first.textContent;
            const heading = headingType.createChecked(
              { level: 1 },
              text ? newState.schema.text(text) : undefined
            );
            tr.replaceWith(0, first.nodeSize, heading);
          }
          return tr.steps.length ? tr : null;
        }
      })
    ];
  }
});
