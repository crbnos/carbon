---
paths: []
triggers: []
promoted: null
---
# Chrome on macOS drops an installed app's Dock badge when its window closes

**Context:** The app icon badge is set by the open tab and by each push (`setAppBadge` in the worker), so it should keep counting while the installed app is closed (2026-10-22).

**Problem:** In Chrome on macOS the badge shows while the app's window is open and disappears when it closes; a push that arrives later, and `setAppBadge` run from the worker's own console, both resolve and draw nothing. Chrome's installed app is a helper process that quits with its window, and the badge belongs to it. The badge also needs macOS notification permission with "Badge app icon" on (System Settings → Notifications → the app).

**Rule:** Do not promise a closed-app badge on macOS Chrome. Test the badge with the app hidden (⌘H), not closed, and test the closed case on a platform meant to keep it (an iPhone Home Screen app) before calling it broken.

**Applies to:** `apps/erp/app/hooks/useAppBadge.ts`, `apps/erp/public/service-worker.js`, the `send-push` badge count.
