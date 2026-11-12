// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { OnshapePanel, parsePanelContext } from "@carbon/ee";
import { getConfiguredOnshapePanelOrigin } from "@carbon/ee/onshape.server";
import type {
  HeadersFunction,
  LoaderFunctionArgs,
  MetaFunction
} from "react-router";
import { data, useLoaderData } from "react-router";
import { path } from "~/utils/path";

export const config = {
  runtime: "nodejs"
};

export const meta: MetaFunction = () => [{ title: "Carbon for Onshape" }];

const ONSHAPE_FRAME_ANCESTORS =
  "frame-ancestors https://onshape.com https://*.onshape.com";

/**
 * The one route Carbon allows to be framed, and only by Onshape.
 */
export const headers: HeadersFunction = ({ loaderHeaders }) => ({
  "Content-Security-Policy":
    loaderHeaders.get("Content-Security-Policy") ?? ONSHAPE_FRAME_ANCESTORS
});

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  // No auth here: the iframe cannot carry the session cookie. The panel signs
  // the user in through a popup and talks to the API with a bearer token.
  const panel = parsePanelContext(url.searchParams);
  if (panel.serverOrigin) return data(panel);

  // Onshape does not publish its Government tenant hosts. A `server` outside
  // onshape.com is trusted only as the Onshape URL of an active
  // `onshape-v2-government` connection.
  const governmentOrigin = await getConfiguredOnshapePanelOrigin(
    url.searchParams.get("server")
  );
  if (!governmentOrigin) return data(panel);
  return data(
    { ...panel, serverOrigin: governmentOrigin },
    {
      headers: {
        "Content-Security-Policy": `${ONSHAPE_FRAME_ANCESTORS} ${governmentOrigin}`
      }
    }
  );
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
        fields: path.to.api.onShapePanelFields,
        session: path.to.api.onShapePanelSession,
        status: path.to.api.onShapePanelStatus,
        planPart: path.to.api.onShapePanelPlanPart,
        planAssembly: path.to.api.onShapePanelPlanAssembly,
        planRelease: path.to.api.onShapePanelPlanRelease,
        pushPart: path.to.api.onShapePanelPushPart,
        pushAssembly: path.to.api.onShapePanelPushAssembly,
        pushRelease: path.to.api.onShapePanelPushRelease,
        releases: path.to.api.onShapePanelReleases
      }}
    />
  );
}
