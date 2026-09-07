import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { pdfjs } from "react-pdf";

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

import {
  CONTROLLED_ENVIRONMENT,
  POSTHOG_API_HOST,
  POSTHOG_PROJECT_PUBLIC_KEY
} from "@carbon/auth";
import { ensureLoggingConfigured } from "@carbon/logger/config.client";
import posthog from "posthog-js";
import { startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

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
//
// The key must be a real PostHog project key (`phc_…`), not just non-empty: a
// placeholder value (e.g. a masked "****" in a local .env) passes a truthiness
// check, and initializing with it makes posthog-js inject its remote-config
// <script> into the document before hydrateRoot(document) runs — an extra DOM
// node React can't match, so the ENTIRE document fails hydration.
if (POSTHOG_PROJECT_PUBLIC_KEY?.startsWith("phc_") && !CONTROLLED_ENVIRONMENT) {
  posthog.init(POSTHOG_PROJECT_PUBLIC_KEY, {
    api_host: POSTHOG_API_HOST
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

startTransition(() => {
  hydrateRoot(document, <HydratedRouter />);
});
