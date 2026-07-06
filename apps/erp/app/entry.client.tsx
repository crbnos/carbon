import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Fragment, startTransition } from "react";
import { pdfjs } from "react-pdf";

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

// function PosthogInit() {
//   useEffect(() => {
//     if (!window?.location.href.includes("localhost")) {
//       posthog.init(POSTHOG_PROJECT_PUBLIC_KEY, {
//         api_host: POSTHOG_API_HOST
//       });
//     }
//   }, []);
//   return null;
// }

startTransition(() => {
  hydrateRoot(
    document,
    <Fragment>
      <HydratedRouter />
      {/* <PosthogInit /> */}
    </Fragment>
  );
});
