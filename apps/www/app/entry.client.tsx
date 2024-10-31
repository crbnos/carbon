import { RemixBrowser } from "@remix-run/react";
import { startTransition } from "react";
import { hydrateRoot } from "react-dom/client";

// function PosthogInit() {
//   useEffect(() => {
//     posthog.init(POSTHOG_PROJECT_PUBLIC_KEY, {
//       api_host: POSTHOG_API_HOST,
//       autocapture: false,
//       capture_pageview: false,
//     });
//   }, []);
//   return null;
// }

startTransition(() => {
  hydrateRoot(
    document,
    // <OperatingSystemContextProvider
    //   platform={window.navigator.userAgent.includes("Mac") ? "mac" : "windows"}
    // >
    //   <I18nProvider
    //     locale={navigator.language ?? navigator.languages?.[0] ?? "en-US"}
    //   >
    <RemixBrowser />
    // </I18nProvider>
    // <PosthogInit />
    // </OperatingSystemContextProvider>
  );
});
