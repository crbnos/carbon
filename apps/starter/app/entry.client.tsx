import {
  POSTHOG_API_HOST,
  POSTHOG_PROJECT_PUBLIC_KEY,
  VERCEL_URL,
} from "@carbon/auth";
import { OperatingSystemContextProvider } from "@carbon/react";
import { I18nProvider } from "@react-aria/i18n";
import { RemixBrowser } from "@remix-run/react";
import posthog from "posthog-js";
import { startTransition, useEffect } from "react";
import { hydrateRoot } from "react-dom/client";

function PosthogInit() {
  useEffect(() => {
    if (VERCEL_URL && !VERCEL_URL?.includes("localhost")) {
      posthog.init(POSTHOG_PROJECT_PUBLIC_KEY, {
        api_host: POSTHOG_API_HOST,
        autocapture: false,
        capture_pageview: false,
      });
    }
  }, []);
  return null;
}

startTransition(() => {
  hydrateRoot(
    document,
    <OperatingSystemContextProvider
      platform={window.navigator.userAgent.includes("Mac") ? "mac" : "windows"}
    >
      <I18nProvider
        locale={navigator.language ?? navigator.languages?.[0] ?? "en-US"}
      >
        <RemixBrowser />
      </I18nProvider>
      <PosthogInit />
    </OperatingSystemContextProvider>
  );
});
