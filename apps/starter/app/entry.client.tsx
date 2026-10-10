// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  POSTHOG_API_HOST,
  POSTHOG_PROJECT_PUBLIC_KEY,
  VERCEL_URL
} from "@carbon/auth";
import { ensureLoggingConfigured } from "@carbon/logger/config.client";
import { OperatingSystemContextProvider } from "@carbon/react";
import posthog from "posthog-js";
import { startTransition, useEffect } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";
import { preloadCatalog } from "~/services/lingui";

ensureLoggingConfigured();

function PosthogInit() {
  useEffect(() => {
    if (VERCEL_URL && !VERCEL_URL?.includes("localhost")) {
      posthog.init(POSTHOG_PROJECT_PUBLIC_KEY!, {
        api_host: POSTHOG_API_HOST,
        autocapture: false,
        capture_pageview: false
      });
    }
  }, []);
  return null;
}

// Fetch the active language's catalog before hydrating, or a non-en page
// hydrates against an empty catalog and mismatches the server markup.
preloadCatalog(document.documentElement.lang).then(() => {
  startTransition(() => {
    hydrateRoot(
      document,
      <OperatingSystemContextProvider
        platform={
          window.navigator.userAgent.includes("Mac") ? "mac" : "windows"
        }
      >
        <HydratedRouter />
        <PosthogInit />
      </OperatingSystemContextProvider>
    );
  });
});
