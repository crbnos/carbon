import { RemixBrowser } from "@remix-run/react";
import posthog from "posthog-js";
import { startTransition, useEffect } from "react";
import { hydrateRoot } from "react-dom/client";
import { POSTHOG_API_HOST, POSTHOG_PROJECT_PUBLIC_KEY } from "~/config/env";
import { OperatingSystemContextProvider } from "./components/OperatingSystem";

function PosthogInit() {
  useEffect(() => {
    posthog.init(POSTHOG_PROJECT_PUBLIC_KEY, {
      api_host: POSTHOG_API_HOST,
      autocapture: false,
      capture_pageview: false,
    });
  }, []);
  return null;
}

startTransition(() => {
  hydrateRoot(
    document,
    <OperatingSystemContextProvider
      platform={window.navigator.userAgent.includes("Mac") ? "mac" : "windows"}
    >
      <RemixBrowser />
      <PosthogInit />
    </OperatingSystemContextProvider>
  );
});
