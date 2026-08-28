import { OnshapePanel, parsePanelContext } from "@carbon/ee";
import type {
  HeadersFunction,
  LoaderFunctionArgs,
  MetaFunction
} from "react-router";
import { useLoaderData } from "react-router";
import { path } from "~/utils/path";

export const config = {
  runtime: "nodejs"
};

export const meta: MetaFunction = () => [{ title: "Carbon for Onshape" }];

/**
 * The one route Carbon allows to be framed, and only by Onshape. Nothing else
 * in the app sets a CSP, so nothing else can be embedded.
 */
export const headers: HeadersFunction = () => ({
  "Content-Security-Policy":
    "frame-ancestors https://onshape.com https://*.onshape.com"
});

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  // No auth here: the iframe cannot carry the session cookie. The panel signs
  // the user in through a popup and talks to the API with a bearer token.
  return parsePanelContext(url.searchParams);
}

export default function OnshapePanelRoute() {
  const { context, serverOrigin } = useLoaderData<typeof loader>();

  return (
    <OnshapePanel
      context={context}
      serverOrigin={serverOrigin}
      paths={{
        auth: path.to.onshapePanelAuth,
        me: path.to.api.onShapePanelMe,
        session: path.to.api.onShapePanelSession,
        status: path.to.api.onShapePanelStatus,
        pushPart: path.to.api.onShapePanelPushPart,
        pushAssembly: path.to.api.onShapePanelPushAssembly,
        pushRelease: path.to.api.onShapePanelPushRelease,
        releases: path.to.api.onShapePanelReleases
      }}
    />
  );
}
