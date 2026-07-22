import { pageBySlug } from "@carbon/onboarding";
import { PlaceholderPage } from "@carbon/onboarding/ui";
import { useLingui } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useParams } from "react-router";
import { path } from "~/utils/path";

// Slugs retired by the seven-phase journey → their replacement pages, so old
// bookmarks keep working.
const RETIRED_SLUGS: Record<string, string> = {
  data: "load-data",
  "go-live": "switch"
};

export async function loader({ params }: LoaderFunctionArgs) {
  const replacement = params.slug ? RETIRED_SLUGS[params.slug] : undefined;
  if (replacement) {
    throw redirect(path.to.getStartedPage(replacement));
  }
  return null;
}

// Catch-all for hub pages not yet built. A real route file (e.g. plan.tsx)
// takes precedence as each page ships.
export default function GetStartedPlaceholderRoute() {
  const { i18n } = useLingui();
  const { slug } = useParams();
  const page = slug ? pageBySlug(slug) : undefined;
  return (
    <PlaceholderPage title={page ? i18n._(page.title) : "Implementation Hub"} />
  );
}
