// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  CONTROLLED_ENVIRONMENT,
  POSTHOG_API_HOST,
  POSTHOG_PROJECT_PUBLIC_KEY
} from "@carbon/auth";
import { getLogger } from "@carbon/logger";
import { ensureLoggingConfigured } from "@carbon/logger/config.client";
import posthog from "posthog-js";
import { startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";
import { preloadCatalog } from "~/services/lingui";
import { SERVICE_WORKER_URL } from "~/utils/service-worker";

ensureLoggingConfigured();

// Initialized at module scope, before hydration, rather than from an effect:
// the authenticated layout calls identify()/register()/group() from its own
// effect, and posthog-js drops those when it isn't loaded yet — register()
// without even a warning. React flushes effects in tree order, so an effect
// here would run after the router's and lose them.
//
// The project key is what enables analytics: it is unset in local development
// and set by the deployment. A hostname check can't stand in for that, since
// `crbn up` serves the app from *.dev rather than localhost.
//
// Controlled (ITAR) environments never initialize analytics — no data about a
// U.S.-Persons-only environment leaves it, even if the key is set.
if (POSTHOG_PROJECT_PUBLIC_KEY?.startsWith("phc_") && !CONTROLLED_ENVIRONMENT) {
  posthog.init(POSTHOG_PROJECT_PUBLIC_KEY, {
    api_host: POSTHOG_API_HOST,
    // LCP, INP and CLS from real sessions: the only way to know which pages are
    // slow for the people using them.
    capture_performance: { web_vitals: true }
  });
}

// Fail-fast boot assertion (NIST 800-171 3.4.6): analytics must never be live in
// a controlled environment. If a regression in the gate above lets posthog load,
// refuse to boot rather than silently phone home about a U.S.-Persons-only system.
if (CONTROLLED_ENVIRONMENT && posthog.__loaded) {
  throw new Error(
    "Analytics initialized in a controlled environment — refusing to boot"
  );
}

// Shows an offline page when a page load finds no network, and carries Web
// Push (public/service-worker.js). Registered for everyone, not only when push
// is on: the offline page is for every user. After the page has loaded, so
// the worker's own download does not compete with the page's; this module can
// run after "load" has fired (the dev server imports it late), so check first.
if ("serviceWorker" in navigator) {
  const register = () => {
    navigator.serviceWorker
      .register(SERVICE_WORKER_URL, { scope: "/" })
      .catch((error) =>
        getLogger("erp", "service-worker").warn("not registered", { error })
      );
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}

// The catalog is no longer in loader data, so fetch the active language's
// chunk before hydrating — otherwise a non-en page hydrates against an empty
// catalog and mismatches the server markup.
preloadCatalog(document.documentElement.lang).then(() => {
  startTransition(() => {
    hydrateRoot(document, <HydratedRouter />);
  });
});
