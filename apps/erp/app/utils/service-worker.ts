// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Carbon's one service worker, at scope "/": the offline page and Web Push
// (public/service-worker.js). Registered on every page load
// (entry.client.tsx); subscribing to push reuses that registration.
//
// It was /push-worker.js until it took on the offline page. A browser keeps
// one registration per scope and its push subscription with it, so
// registering this URL at "/" swaps the script under an existing push
// registration without losing the subscription.
export const SERVICE_WORKER_URL = "/service-worker.js";
