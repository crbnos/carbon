---
paths: []
triggers: []
promoted: null
---
# react-pdf: `wrap={false}` loses text when the node is taller than the page

**Context:** A list item in a PDF note rendered its bullet on one page and its text on the
next (TCK-57). The obvious fix was `wrap={false}` on the item row.

**Problem:** react-pdf 3.x keeps a paragraph of three lines or fewer whole, because
`widows` and `orphans` default to 2. The paragraph moved to the next page and left its
one-line bullet behind. `wrap={false}` fixes that, but react-pdf cannot split an unbreakable
node that is taller than the page. It draws the node past the page bottom and the text is
lost. Height does not follow text length: many line breaks or short paragraphs make a tall
node from little text.

**Rule:** Put `wrap={false}` only on a node you can prove fits on a page. Decide it in a pure
function and count each line break or block as a full line, as `keepListItemTogether` in
`Note.tsx` does. Prove a page-break change by rendering at many offsets and reading each
page's text back (pdfjs). A single render can land away from the boundary.

**Applies to:** `packages/documents/src/pdf/**`, any `wrap={false}` or `minPresenceAhead`.
