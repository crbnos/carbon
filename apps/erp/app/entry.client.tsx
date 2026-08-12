import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { startTransition } from "react";
import { pdfjs } from "react-pdf";

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

import {
  CONTROLLED_ENVIRONMENT,
  POSTHOG_API_HOST,
  POSTHOG_PROJECT_PUBLIC_KEY
} from "@carbon/auth";
import { ensureLoggingConfigured } from "@carbon/logger/config.client";
import posthog from "posthog-js";
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
if (POSTHOG_PROJECT_PUBLIC_KEY && !CONTROLLED_ENVIRONMENT) {
  posthog.init(POSTHOG_PROJECT_PUBLIC_KEY, {
    api_host: POSTHOG_API_HOST
  });
}

startTransition(() => {
  hydrateRoot(document, <HydratedRouter />);
});
