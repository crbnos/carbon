# Navigation footer alignment

Last tested: 2026-11-05
Surface: the shared NavRail used by the ERP and MES shells.

## Prerequisites

- A page using the real `NavRail` with footer controls; the ERP footer has
  Settings and Customize.
- Desktop widths of 1440 and 1024px, plus a short window with enough navigation
  rows to require vertical scrolling.
- Use non-overlay/always-visible scrollbars to expose the original issue.

## Steps

1. Start with navigation unpinned and the pointer outside the rail. Record the
   footer controls' `getBoundingClientRect().y` positions.
2. Move the pointer over the rail and wait for its 150ms hover delay and width
   transition. Both footer positions must stay unchanged.
3. Move outside again, then pin and unpin navigation. Check the same positions
   in every state. Expected displacement: 0px (allow 0.5px rounding tolerance).
4. Focus Settings with the keyboard. Its focus ring must remain visible.
5. In a short window, scroll navigation to the end. Footer controls must be
   reachable and vertical scrolling must still work in both rail states.
6. At 390px, open the mobile navigation and close it with Escape. The document
   must have no horizontal overflow.

## Selector notes

- Desktop scroll container: `nav[data-sliding-hover]`.
- Expanded/collapsed state: the container's `data-state`.
- Controls: accessible names Settings and Customize in the English locale.
- The desktop container must compute `overflow-x: hidden` and
  `overflow-y: auto`.

## Verified evidence

An isolated browser harness using the actual components, ERP CSS, and theme
reproduced the old 10px displacement at 1440x900, 1024x768, and 900x480, then
verified 0px after the fix. Focus, vertical scroll, and mobile drawer smoke
checks passed. The harness does not verify full application routing.

The full ERP app was also checked: the local test account reached `/x`, the
dashboard rendered without browser errors, and both footer controls stayed
at the same vertical position when the rail expanded.
