import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/** Matches a single-brace merge token like `{invoice.number}`. */
const TOKEN_RE = /\{[\w.]+\}/g;

const KNOWN_CLS = "rounded-sm bg-blue-500/25 ring-1 ring-blue-500/50 px-0.5";
const UNKNOWN_CLS =
  "rounded-sm bg-destructive/20 ring-1 ring-destructive/50 px-0.5";

export interface MergeTokenHighlightOptions {
  /**
   * Token names considered valid (e.g. `invoice.number`). Known tokens render
   * blue, unknown ones red — mirroring the storage-rules condition builder.
   * An empty list treats every `{token}` as known.
   */
  knownTokens: string[];
}

/**
 * Visually highlights `{token}` merge fields with an inline decoration. Purely
 * decorative — the document content stays plain `{token}` text, so merge-field
 * interpolation is unaffected.
 */
export const MergeTokenHighlight = Extension.create<MergeTokenHighlightOptions>(
  {
    name: "mergeTokenHighlight",

    addOptions() {
      return { knownTokens: [] };
    },

    addProseMirrorPlugins() {
      const options = this.options;
      return [
        new Plugin({
          key: new PluginKey("mergeTokenHighlight"),
          props: {
            decorations(state) {
              const known = new Set(options.knownTokens);
              const decorations: Decoration[] = [];
              state.doc.descendants((node, pos) => {
                if (!node.isText || !node.text) return;
                const re = new RegExp(TOKEN_RE);
                let match: RegExpExecArray | null = re.exec(node.text);
                while (match !== null) {
                  const token = match[0].slice(1, -1);
                  const cls =
                    known.size === 0 || known.has(token)
                      ? KNOWN_CLS
                      : UNKNOWN_CLS;
                  const from = pos + match.index;
                  decorations.push(
                    Decoration.inline(from, from + match[0].length, {
                      class: cls
                    })
                  );
                  match = re.exec(node.text);
                }
              });
              return DecorationSet.create(state.doc, decorations);
            }
          }
        })
      ];
    }
  }
);
