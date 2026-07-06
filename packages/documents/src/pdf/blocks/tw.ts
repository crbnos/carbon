import { createContext, useContext } from "react";
import { createTw } from "react-pdf-tailwind";
import { DEFAULT_THEME, type DocumentTheme } from "../../template";

type Tw = ReturnType<typeof createTw>;

/**
 * Build a Tailwind instance for sales-document blocks whose gray palette is
 * driven by the document theme. The blocks reference semantic grays
 * (`text-gray-800` body, `text-gray-600` headings, `border-gray-200`…), so
 * remapping the palette re-colors every block from one place instead of
 * touching each call site.
 */
export function makeDocTw(theme: DocumentTheme): Tw {
  return createTw({
    theme: {
      fontFamily: {
        sans: ["Inter", "Helvetica", "Arial", "sans-serif"]
      },
      extend: {
        colors: {
          gray: {
            50: "#f9fafb",
            200: "#e5e7eb",
            400: "#9ca3af",
            // Theme-driven: section headings + body text.
            600: theme.heading,
            800: theme.text
          }
        }
      }
    }
  });
}

/**
 * Default (unthemed) instance — also the context fallback, so a shared block
 * rendered outside a themed document still produces the original palette.
 */
export const tw: Tw = makeDocTw(DEFAULT_THEME);

/** The document theme + its derived `tw`, shared with the whole block tree. */
export interface DocStyle {
  tw: Tw;
  theme: DocumentTheme;
}

const DocStyleContext = createContext<DocStyle>({
  tw,
  theme: DEFAULT_THEME
});

/** Provide a document's theme (and derived `tw`) to its block tree. */
export const DocStyleProvider = DocStyleContext.Provider;

/** Read the document-themed `tw` (falls back to the default palette). */
export function useTw(): Tw {
  return useContext(DocStyleContext).tw;
}

/** Read the raw document theme (e.g. for inline `theme.accent` styling). */
export function useDocTheme(): DocumentTheme {
  return useContext(DocStyleContext).theme;
}
