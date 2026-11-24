---
paths: []
triggers: []
promoted: null
---
# A React handler on a dialog also hears the dialogs opened from inside it

**Context:** On phones every `Modal` and `Drawer` is a bottom sheet, and a sheet drags
down from its header. The drag handlers sit on the sheet's panel (`BottomSheetContent`).
Account settings is a sheet, and the signature dialog opens from one of its panes.

**Problem:** React passes a synthetic event up through the React tree, not the DOM
tree, so it crosses portals. The signature sheet is portaled to `<body>`, but it is
rendered inside the account pane, so a press on its header also reached the account
sheet's `onPointerDown`. Both sheets started a drag, and closing the signature also
closed account settings.

**Rule:** A handler on a dialog panel that acts on `event.target` checks that the
target is in its own panel (`panel.contains(...)`), never only that it matches a
selector. A dialog opened from inside it is a different panel that still delivers its
events here.

**Applies to:** `startsSheetDrag` (`packages/react/src/utils/dialog.ts`), and any
`onPointer*`, `onKeyDown` or `onClick` placed on a `Modal`, `Drawer`, `BottomSheet` or
popover content.
