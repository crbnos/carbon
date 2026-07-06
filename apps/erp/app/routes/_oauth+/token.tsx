import { hashOAuthSecret } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { validator } from "@carbon/form";
import { createHash } from "crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { z } from "zod";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json"
};

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  return new Response(
    JSON.stringify({
      error: "method_not_allowed",
      error_description: "Use POST"
    }),
    { status: 405, headers: corsHeaders }
  );
}

const oauthTokenValidator = z.object({
  grant_type: z.enum(["authorization_code", "refresh_token"]),
  client_id: z.string(),
  client_secret: z.string().optional(),
  code: z.string().optional(),
  redirect_uri: z.string().url().optional(),
  refresh_token: z.string().optional(),
  code_verifier: z.string().optional()
});

function verifyCodeChallenge(
  codeVerifier: string,
  codeChallenge: string,
  method: string
): boolean {
  if (method !== "S256") return false;
  const hash = createHash("sha256").update(codeVerifier).digest();
  const base64url = hash
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return base64url === codeChallenge;
}

function jsonResponse(body: unknown, status: number = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const client = getCarbonServiceRole();
  const validation = await validator(oauthTokenValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return jsonResponse(
      {
        error: "invalid_request",
        error_description: "Invalid request parameters"
      },
      400
    );
  }

  const {
    grant_type,
    client_id,
    client_secret,
    code,
    redirect_uri,
    refresh_token,
    code_verifier
  } = validation.data;

  const oauthClientResult = await client
    .from("oauthClient")
    .select("*")
    .eq("clientId", client_id)
    .single();

  if (!oauthClientResult.data) {
    return jsonResponse(
      { error: "invalid_client", error_description: "Unknown client" },
      401
    );
  }

  const oauthClient = oauthClientResult.data;

  if (oauthClient.tokenEndpointAuthMethod !== "none") {
    if (
      !client_secret ||
      oauthClient.clientSecret !== hashOAuthSecret(client_secret)
    ) {
      return jsonResponse(
        {
          error: "invalid_client",
          error_description: "Invalid client credentials"
        },
        401
      );
    }
  }

  if (grant_type === "authorization_code") {
    if (!code || !redirect_uri) {
      return jsonResponse(
        {
          error: "invalid_request",
          error_description: "Missing code or redirect_uri"
        },
        400
      );
    }

    // Atomically consume the authorization code (delete-first prevents replay)
    const oauthCode = await client
      .from("oauthCode")
      .delete()
      .eq("code", code)
      .select("*")
      .single();

    if (!oauthCode.data) {
      return jsonResponse(
        {
          error: "invalid_grant",
          error_description: "Invalid authorization code"
        },
        400
      );
    }

    const codeData = oauthCode.data;

    if (codeData.clientId !== client_id) {
      return jsonResponse(
        {
          error: "invalid_grant",
          error_description: "Code was not issued to this client"
        },
        400
      );
    }

    if (codeData.redirectUri !== redirect_uri) {
      return jsonResponse(
        { error: "invalid_grant", error_description: "Redirect URI mismatch" },
        400
      );
    }

    if (new Date(codeData.expiresAt) < new Date()) {
      return jsonResponse(
        {
          error: "invalid_grant",
          error_description: "Authorization code has expired"
        },
        400
      );
    }

    // Verify PKCE if code_challenge was stored
    if (codeData.codeChallenge) {
      if (!code_verifier) {
        return jsonResponse(
          {
            error: "invalid_grant",
            error_description: "PKCE code_verifier required"
          },
          400
        );
      }

      const method = codeData.codeChallengeMethod || "S256";
      if (!verifyCodeChallenge(code_verifier, codeData.codeChallenge, method)) {
        return jsonResponse(
          {
            error: "invalid_grant",
            error_description: "PKCE verification failed"
          },
          400
        );
      }
    }

    // Generate access token and refresh token
    const rawAccessToken = crypto.randomUUID();
    const rawRefreshToken = crypto.randomUUID();

    const tokenInsert = {
      accessToken: hashOAuthSecret(rawAccessToken),
      refreshToken: hashOAuthSecret(rawRefreshToken),
      clientId: client_id,
      userId: codeData.userId,
      companyId: codeData.companyId,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString()
    };

    const tokenResult = await client.from("oauthToken").insert([tokenInsert]);

    if (tokenResult.error) {
      return jsonResponse(
        { error: "server_error", error_description: "Failed to create token" },
        500
      );
    }

    return jsonResponse({
      access_token: rawAccessToken,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: rawRefreshToken,
      scope: codeData.scope || undefined
    });
  } else if (grant_type === "refresh_token") {
    if (!refresh_token) {
      return jsonResponse(
        {
          error: "invalid_request",
          error_description: "Missing refresh_token"
        },
        400
      );
    }

    // Verify the refresh token
    const tokenResult = await client
      .from("oauthToken")
      .select("*")
      .eq("refreshToken", hashOAuthSecret(refresh_token))
      .single();

    if (!tokenResult.data) {
      return jsonResponse(
        { error: "invalid_grant", error_description: "Invalid refresh token" },
        400
      );
    }

    const refreshTokenData = tokenResult.data;

    if (refreshTokenData.clientId !== client_id) {
      return jsonResponse(
        {
          error: "invalid_grant",
          error_description: "Refresh token was not issued to this client"
        },
        400
      );
    }

    // Generate new access token
    const rawNewAccessToken = crypto.randomUUID();

    const updateResult = await client
      .from("oauthToken")
      .update({
        accessToken: hashOAuthSecret(rawNewAccessToken),
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString()
      })
      .eq("refreshToken", hashOAuthSecret(refresh_token));

    if (updateResult.error) {
      return jsonResponse(
        { error: "server_error", error_description: "Failed to refresh token" },
        500
      );
    }

    return jsonResponse({
      access_token: rawNewAccessToken,
      token_type: "Bearer",
      expires_in: 3600,
      scope: refreshTokenData.scope || undefined
    });
  }

  return jsonResponse(
    {
      error: "unsupported_grant_type",
      error_description: "Unsupported grant type"
    },
    400
  );
}
