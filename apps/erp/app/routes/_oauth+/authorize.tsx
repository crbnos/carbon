import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { validator } from "@carbon/form";
import { Button, Heading, VStack } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Form, redirect, useLoaderData } from "react-router";
import { z } from "zod";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "settings"
  });

  const userCompanies = await client
    .from("userToCompany")
    .select("companyId, company:companyId(name)")
    .eq("userId", userId);

  const companies = (userCompanies.data ?? []).map((uc) => ({
    id: uc.companyId,
    name: (uc.company as unknown as { name: string })?.name ?? uc.companyId
  }));

  const url = new URL(request.url);
  const clientId = url.searchParams.get("client_id");
  const redirectUri = url.searchParams.get("redirect_uri");
  const scope = url.searchParams.get("scope");

  let clientName = "Unknown Application";
  let redirectDomain: string | null = null;
  if (clientId) {
    const serviceRole = getCarbonServiceRole();
    const oauthClient = await serviceRole
      .from("oauthClient")
      .select("name")
      .eq("clientId", clientId)
      .single();
    if (oauthClient.data) {
      clientName = oauthClient.data.name;
    }
  }
  if (redirectUri) {
    try {
      redirectDomain = new URL(redirectUri).hostname;
    } catch {
      // invalid URL — will be caught by the action validator
    }
  }

  return {
    companyId,
    companies,
    clientName,
    redirectDomain,
    scope
  };
}

const formValidator = z.object({
  company_id: z.string()
});

export async function action({ request }: ActionFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {
    update: "settings"
  });

  const validation = await validator(formValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return data({ error: "Invalid request" }, { status: 400 });
  }

  const { company_id } = validation.data;

  // Read OAuth params from the URL (not the form) to avoid whitespace
  // corruption from copy-paste line wrapping in hidden input values
  const url = new URL(request.url);
  const param = (key: string) =>
    url.searchParams.get(key)?.replace(/\s/g, "") ?? null;
  const response_type = url.searchParams.get("response_type");
  const client_id = param("client_id");
  const redirect_uri = url.searchParams.get("redirect_uri");
  const state = url.searchParams.get("state");
  const scope = url.searchParams.get("scope");
  const code_challenge = param("code_challenge");
  const code_challenge_method = param("code_challenge_method");

  if (response_type !== "code") {
    return data(
      { error: "Unsupported response_type. Must be 'code'." },
      { status: 400 }
    );
  }

  if (!client_id || !redirect_uri) {
    return data(
      { error: "Missing client_id or redirect_uri" },
      { status: 400 }
    );
  }

  // Verify the user belongs to the selected company
  const membership = await client
    .from("userToCompany")
    .select("companyId")
    .eq("userId", userId)
    .eq("companyId", company_id)
    .single();

  if (!membership.data) {
    return data({ error: "Invalid company" }, { status: 403 });
  }

  const serviceRole = getCarbonServiceRole();

  const oauthClientResult = await serviceRole
    .from("oauthClient")
    .select("*")
    .eq("clientId", client_id)
    .single();

  if (!oauthClientResult.data) {
    return data({ error: "Invalid client" }, { status: 400 });
  }

  const oauthClient = oauthClientResult.data;

  if (!oauthClient.redirectUris.includes(redirect_uri)) {
    return data({ error: "Invalid redirect URI" }, { status: 400 });
  }

  if (oauthClient.tokenEndpointAuthMethod === "none" && !code_challenge) {
    return data({ error: "PKCE required for public clients" }, { status: 400 });
  }

  // Generate and store authorization code
  const code = crypto.randomUUID();
  const codeResult = await serviceRole.from("oauthCode").insert([
    {
      code,
      clientId: client_id,
      userId,
      companyId: company_id,
      redirectUri: redirect_uri,
      scope: scope || null,
      codeChallenge: code_challenge || null,
      codeChallengeMethod: code_challenge_method || null,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
    }
  ]);

  if (codeResult.error) {
    return data(
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
  const { clientName, companyId, companies, redirectDomain, scope } =
    useLoaderData<typeof loader>();

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <div className="flex w-[380px] flex-col items-center space-y-6">
        <div className="flex justify-center">
          <img
            src="/carbon-mark-light.svg"
            alt="Carbon Logo"
            className="w-24 dark:hidden"
          />
          <img
            src="/carbon-mark-dark.svg"
            alt="Carbon Logo"
            className="hidden w-24 dark:block"
          />
        </div>
        <div className="w-full rounded-lg p-8 md:border md:border-border md:bg-card md:shadow-lg">
          <Form method="post">
            <VStack spacing={4} className="items-center">
              <Heading size="h3" className="text-balance text-center">
                Authorize Application
              </Heading>
              <p className="text-center text-sm text-pretty text-muted-foreground">
                <strong className="text-foreground">{clientName}</strong>
                {redirectDomain && (
                  <span className="text-xs"> ({redirectDomain})</span>
                )}{" "}
                is requesting access to your Carbon account.
              </p>
              <div className="flex w-full flex-col gap-1.5">
                <label
                  htmlFor="company_id"
                  className="text-sm font-medium text-foreground"
                >
                  Company
                </label>
                {companies.length === 1 ? (
                  <>
                    <input
                      type="hidden"
                      name="company_id"
                      value={companies[0].id}
                    />
                    <p className="text-sm text-muted-foreground">
                      {companies[0].name}
                    </p>
                  </>
                ) : (
                  <select
                    id="company_id"
                    name="company_id"
                    defaultValue={companyId}
                    className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {scope && (
                <div className="w-full rounded-md border border-border bg-muted/50 px-3 py-2 text-center text-sm text-muted-foreground">
                  Scope: {scope}
                </div>
              )}
              <Button type="submit" size="lg" className="w-full">
                Authorize
              </Button>
            </VStack>
          </Form>
        </div>
      </div>
    </div>
  );
}
