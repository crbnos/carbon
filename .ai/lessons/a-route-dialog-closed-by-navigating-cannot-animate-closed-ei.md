---
paths: ["packages/react/src/Modal.tsx", "packages/react/src/Drawer.tsx"]
triggers: ["useRouteDialog", "useCloseRoute", "ConfirmDelete", "ModalOverlay"]
promoted: null
---
# A route dialog closed by navigating cannot animate closed either

**Context:** Every modal and drawer in the ERP animated in and vanished on close (New Gauge was
the report). The drawer lesson above fixed only the planning drawers.

**Problem:** Two patterns removed the dialog in the same render. A route that renders a form as
a dialog held `open` at `true` and closed by `useCloseRoute()` / `navigate(...)`: the navigation
removed the route, so `open` never turned false. And about 300 call sites rendered
`{disclosure.isOpen && <ConfirmDelete />}`. The modal backdrop also closed in 150ms while the
box closed in 200ms, and Radix removes both when the backdrop ends.

**Rule:** A route dialog uses `useRouteDialog()` (`@carbon/react`): `close` sets `open` false
and navigates only when Radix has removed the dialog. With unsaved changes it navigates at once,
so the `Submit` blocker asks over the open dialog — closing first would unmount the blocker and
lose the edits silently. A conditional dialog passes its condition as `open`/`isOpen` and keeps
its record until the next open. State or a mount-time fetch that must be fresh per open goes in a
body component inside `ModalContent` / `DrawerContent`, which Radix unmounts on close. A `key` that
counts opens is only for state that cannot move there (a `ModalCard` form, or `Modal` /
`ModalContent` props that read it). The first attempt keyed about 150 dialogs per open: it worked,
but it fought Radix's own unmount, and the guard around it mounted nothing until the first open for
no reason. Enforced by `no-unmounting-dialog`.

**Applies to:** every `Modal`, `Drawer`, `ModalDrawer`, `Confirm`, `ConfirmDelete` and
`*Modal`/`*Drawer` component; `ModalOverlay` and `ModalContent` durations must match.
