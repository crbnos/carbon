import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { requirePlan } from "@carbon/ee/plan.server";
import { Alert, AlertDescription, AlertTitle } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import type { ActionFunctionArgs } from "react-router";
import { data, useFetcher, useNavigate, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { ApiKey } from "~/modules/settings";
import {
  ApiKeyView,
  RegenerateApiKeyModal,
  regenerateApiKey
} from "~/modules/settings";
import { mintApiKey } from "~/modules/settings/settings.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "users"
  });

  await requirePlan({
    request,
    client,
    companyId,
    feature: "API_KEYS",
    redirectTo: path.to.apiKeys
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  // Same minting as creation; the raw value leaves this action exactly once
  const { rawKey, keyHash, keyPreview } = mintApiKey();

  const regenerated = await regenerateApiKey(client, {
    id,
    companyId,
    keyHash,
    keyPreview,
    rawKey,
    updatedBy: userId
  });

  if (regenerated.error) {
    return data(
      {},
      await flash(
        request,
        error(regenerated.error, "Failed to regenerate API key")
      )
    );
  }

  const key = regenerated.data?.key;
  if (!key) {
    return data(
      {},
      await flash(request, error(regenerated, "Failed to regenerate API key"))
    );
  }

  return data({ key }, { status: 200 });
}

export default function RegenerateApiKeyRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const navigate = useNavigate();
  const routeData = useRouteData<{ apiKeys: ApiKey[] }>(path.to.apiKeys);
  const fetcher = useFetcher<{ key?: string }>();
  const [key, setKey] = useState<string | null>(null);

  useEffect(() => {
    if (fetcher.data?.key) {
      setKey(fetcher.data.key);
    }
  }, [fetcher.data]);

  const apiKey = routeData?.apiKeys.find((apiKey) => apiKey.id === id);
  if (!apiKey) return null;

  const onClose = () => navigate(-1);

  if (key) {
    return (
      <ApiKeyView
        apiKey={key}
        notice={
          <Alert variant="destructive">
            <LuTriangleAlert className="w-4 h-4" />
            <AlertTitle>
              <Trans>The previous key has stopped working</Trans>
            </AlertTitle>
            <AlertDescription>
              <Trans>
                Update every integration that authenticates as {apiKey.name}.
              </Trans>
            </AlertDescription>
          </Alert>
        }
        onClose={onClose}
      />
    );
  }

  return (
    <RegenerateApiKeyModal
      action={path.to.regenerateApiKey(id)}
      name={apiKey.name}
      lastUsedAt={apiKey.lastUsedAt}
      expiresAt={apiKey.expiresAt}
      fetcher={fetcher}
      onCancel={onClose}
    />
  );
}
