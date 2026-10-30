// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useSearchParams } from "react-router";
import { useRouteData } from "~/hooks";
import {
  apiKeyFields,
  apiKeyValidator
} from "~/modules/settings/settings.models";
import { ApiKeyChooser, ApiKeyForm } from "~/modules/settings/ui";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    update: "users"
  });

  return null;
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(apiKeyValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.settings.createApiKey(apiKeyFields(input.data));
}

export default function NewApiKeyRoute() {
  const closeRoute = useCloseRoute();
  const routeData = useRouteData<{ companyId: string }>(path.to.apiKeys);
  // A CI job or cloud workload needs no key at all: offer federation first.
  const [isChoosing, setIsChoosing] = useState(true);
  const [searchParams] = useSearchParams();

  const initialValues = {
    name: ""
  };

  if (isChoosing) {
    return (
      <ApiKeyChooser
        query={searchParams.toString()}
        onContinue={() => setIsChoosing(false)}
        onClose={() => closeRoute()}
      />
    );
  }

  return (
    <ApiKeyForm
      onClose={() => closeRoute()}
      initialValues={initialValues}
      companyId={routeData?.companyId}
    />
  );
}
