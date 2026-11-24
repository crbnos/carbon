---
paths: ["packages/react/src/Sidebar.tsx", "packages/react/src/NavRail.tsx"]
triggers: ["document.cookie", "localStorage", "SidebarProvider"]
promoted: null
---
# A cookie that was only ever written is not a stored preference

**Context:** The navigation rail's pin toggle (2026-10-13) first restored the pinned state from `SidebarProvider`'s `sidebar:state` cookie.

**Problem:** `SidebarProvider` (`packages/react/src/Sidebar.tsx`) had written that cookie on every open/close for a long time, but no loader read it. Old sessions already held `sidebar:state=true` from a `SidebarTrigger` or ⌘B, so reading it opened the rail for users who had never pinned it.

The write was then removed (nothing reads it), so the rail always starts collapsed.

**Rule:** Do not start reading a cookie, local-storage key or column that code has only ever written. Its values were never a user's deliberate choice. Give the new preference a new name, or start every user from the default.

**Applies to:** `SidebarProvider` and any other write-only client state (`document.cookie`, `localStorage`) that a loader or component begins to read.
