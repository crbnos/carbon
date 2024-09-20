import { validator } from "@carbon/form";
import { Button } from "@carbon/react";
import { Form, json, redirect, useLoaderData } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { z } from "zod";
import { requirePermissions } from "~/services/auth/auth.server";

export const config = { runtime: "nodejs" };

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "settings",
  });

  const [companies] = await Promise.all([
    client.from("userToCompany").select("companyId").eq("userId", userId),
  ]);

  if (!companies.data) {
    throw new Error("Failed to load companies for user");
  }

  const url = new URL(request.url);
  const clientId = url.searchParams.get("client_id");
  const redirectUri = url.searchParams.get("redirect_uri");
  const responseType = url.searchParams.get("response_type");
  const state = url.searchParams.get("state");

  return { companyId, companies, clientId, redirectUri, responseType, state };
}

const authorizeValidator = z.object({
  client_id: z.string(),
  redirect_uri: z.string().url(),
  response_type: z.literal("code"),
  state: z.string().optional(),
});

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "settings",
  });

  const validation = await validator(authorizeValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return json({ error: "Invalid request" }, { status: 400 });
  }

  const { client_id, redirect_uri, state } = validation.data;

  // Verify client_id and redirect_uri
  const [oauthClient] = await Promise.all([
    client.from("oauthClient").select("*").eq("clientId", client_id).single(),
  ]);

  if (
    !oauthClient.data ||
    !oauthClient.data.redirectUris.includes(redirect_uri)
  ) {
    return json({ error: "Invalid client or redirect URI" }, { status: 400 });
  }

  // Generate and store authorization code
  const code = crypto.randomUUID();
  const [codeResult] = await Promise.all([
    client.from("oauthCode").insert([
      {
        code,
        clientId: client_id,
        userId,
        companyId,
        redirectUri: redirect_uri,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 minutes expiration
      },
    ]),
  ]);

  if (codeResult.error) {
    return json(
      { error: "Failed to create authorization code" },
      { status: 500 }
    );
  }

  // Redirect to the client's redirect URI with the code and state
  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.append("code", code);
  if (state) {
    redirectUrl.searchParams.append("state", state);
  }

  return redirect(redirectUrl.toString());
}

export default function AuthorizeRoute() {
  const { clientId, redirectUri, responseType, state } =
    useLoaderData<typeof loader>();

  return (
    <div className="max-w-md mx-auto mt-8">
      <h2 className="text-2xl font-bold mb-4">Authorize Application</h2>
      <p className="mb-4">Do you want to authorize this application?</p>
      <Form method="post">
        <input type="hidden" name="client_id" value={clientId || ""} />
        <input type="hidden" name="redirect_uri" value={redirectUri || ""} />
        <input type="hidden" name="response_type" value={responseType || ""} />
        {state && <input type="hidden" name="state" value={state} />}
        <Button>Authorize</Button>
      </Form>
    </div>
  );
}
