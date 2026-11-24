---
paths: []
triggers: []
promoted: null
---
# Pointer capture taken on press steals the tap's click

**Context:** A bottom sheet drags down from its whole header, so its handlers sit on the
panel and a press anywhere in the header that is not a control starts a drag.

**Problem:** The drag called `setPointerCapture` on `pointerdown`. With the pointer
captured, `pointerup` goes to the panel, and the browser sends the `click` to the
panel too. A header chip with an `onClick` (not a `button`, so not excluded as a
control) stopped responding to taps.

**Rule:** A drag that starts on content which can also be tapped takes the pointer
only once it has moved a few pixels (`DRAG_SLOP_PX`). Until then a tap is a tap.

**Applies to:** `BottomSheetContent` (`packages/react/src/BottomSheet.tsx`), and any
drag handle that wraps clickable content.
