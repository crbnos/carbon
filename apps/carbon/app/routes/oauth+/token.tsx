import { getCarbonServiceRole } from "@carbon/auth";
import { validator } from "@carbon/form";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { z } from "zod";

const oauthTokenValidator = z.object({
  grant_type: z.enum(["authorization_code", "refresh_token"]),
  client_id: z.string(),
  client_secret: z.string(),
  code: z.string().optional(),
  redirect_uri: z.string().url().optional(),
  refresh_token: z.string().optional(),
});

export async function action({ request }: ActionFunctionArgs) {
  const client = getCarbonServiceRole();
  const validation = await validator(oauthTokenValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return json({ data: null, error: "Invalid request" }, { status: 400 });
  }

  const {
    grant_type,
    client_id,
    client_secret,
    code,
    redirect_uri,
    refresh_token,
  } = validation.data;

  const [oauthClient] = await Promise.all([
    client.from("oauthClient").select("*").eq("clientId", client_id).single(),
  ]);

  if (!oauthClient.data || oauthClient.data.clientSecret !== client_secret) {
    return json(
      {
        data: null,
        error: "Invalid client credentials",
      },
      { status: 401 }
    );
  }

  if (grant_type === "authorization_code") {
    if (!code || !redirect_uri) {
      return json(
        {
          data: null,
          error: "Invalid request",
        },
        { status: 400 }
      );
    }

    // Verify the authorization code
    const [oauthCode] = await Promise.all([
      client.from("oauthCode").select("*").eq("code", code).single(),
    ]);

    if (
      !oauthCode.data ||
      oauthCode.data.clientId !== client_id ||
      oauthCode.data.redirectUri !== redirect_uri
    ) {
      return json(
        {
          data: null,
          error: "Invalid authorization code",
        },
        { status: 400 }
      );
    }

    // Generate access token and refresh token
    const accessToken = crypto.randomUUID() as string;
    const refreshToken = crypto.randomUUID() as string;

    const [tokenResult] = await Promise.all([
      client.from("oauthToken").insert([
        {
          accessToken,
          refreshToken,
          clientId: client_id,
          userId: oauthCode.data.userId,
          companyId: oauthCode.data.companyId,
          createdAt: new Date(Date.now()).toISOString(),
          expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(), // 1 hour expiration
        },
      ]),
    ]);

    if (tokenResult.error) {
      return json(
        { data: null, error: "Failed to create token" },
        { status: 500 }
      );
    }

    // Delete the used authorization code
    await client.from("oauthCode").delete().eq("code", code);

    return json({
      data: {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: refreshToken,
      },
      error: null,
    });
  } else if (grant_type === "refresh_token") {
    if (!refresh_token) {
      return json(
        {
          data: null,
          error: "Invalid request",
        },
        { status: 400 }
      );
    }

    // Verify the refresh token
    const [tokenResult] = await Promise.all([
      client
        .from("oauthToken")
        .select("*")
        .eq("refreshToken", refresh_token)
        .single(),
    ]);

    if (!tokenResult.data || tokenResult.data.clientId !== client_id) {
      return json(
        { data: null, error: "Invalid refresh token" },
        { status: 400 }
      );
    }

    // Generate new access token
    const newAccessToken = crypto.randomUUID();

    const [updateResult] = await Promise.all([
      client
        .from("oauthToken")
        .update({
          accessToken: newAccessToken,
          expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(), // 1 hour expiration
        })
        .eq("refreshToken", refresh_token),
    ]);

    if (updateResult.error) {
      return json(
        { error: "server_error", error_description: "Failed to refresh token" },
        { status: 500 }
      );
    }

    return json({
      data: {
        access_token: newAccessToken,
        token_type: "Bearer",
        expires_in: 3600,
      },
      error: null,
    });
  }

  // This should never happen due to the validator, but TypeScript doesn't know that
  return json(
    {
      data: null,
      error: "Unsupported grant type",
    },
    { status: 400 }
  );
}
