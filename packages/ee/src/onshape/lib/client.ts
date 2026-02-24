import { ONSHAPE_CLIENT_ID, ONSHAPE_CLIENT_SECRET } from "@carbon/auth";
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import axios from "axios";

interface OnshapeClientConfig {
  baseUrl: string;
  accessToken: string;
}

export interface OnshapePart {
  id: string;
  name: string;
  partNumber: string;
  revision: string;
  description: string;
  metadata: Record<string, string>;
}

export class OnshapeClient {
  private baseUrl: string;
  private accessToken: string;
  private axiosInstance: ReturnType<typeof axios.create>;

  constructor(config: OnshapeClientConfig) {
    this.baseUrl = config.baseUrl;
    this.accessToken = config.accessToken;

    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      headers: this.getAuthHeaders()
    });
  }

  private getAuthHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "application/json;charset=UTF-8; qs=0.09",
      Authorization: `Bearer ${this.accessToken}`
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    try {
      const response = await this.axiosInstance.request<T>({
        method,
        url: path,
        data: body
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `Onshape API error (${error.response?.status}): ${
            typeof error.response?.data === "string"
              ? error.response.data
              : JSON.stringify(error.response?.data)
          }`
        );
      }
      throw error;
    }
  }

  async getDocuments(limit: number = 20, offset: number = 0): Promise<any> {
    return this.request(
      "GET",
      `/api/v10/documents?limit=${limit}&offset=${offset}`
    );
  }

  async getVersions(
    documentId: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<any> {
    return this.request(
      "GET",
      `/api/v10/documents/d/${documentId}/versions?limit=${limit}&offset=${offset}`
    );
  }

  async getElements(
    documentId: string,
    versionId: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<any> {
    return this.request(
      "GET",
      `/api/v10/documents/d/${documentId}/v/${versionId}/elements`
    );
  }

  async getBillOfMaterials(
    documentId: string,
    versionId: string,
    elementId: string
  ): Promise<any> {
    return this.request(
      "GET",
      `/api/v10/assemblies/d/${documentId}/v/${versionId}/e/${elementId}/bom?indented=true&multiLevel=true&generateIfAbsent=true&onlyVisibleColumns=true&includeItemMicroversions=false&includeTopLevelAssemblyRow=true&thumbnail=false`
    );
  }

  static async refreshAccessToken(refreshToken: string): Promise<{
    access_token: string;
    refresh_token: string;
    token_type: string;
  }> {
    if (!ONSHAPE_CLIENT_ID || !ONSHAPE_CLIENT_SECRET) {
      throw new Error("Onshape OAuth not configured");
    }

    const response = await fetch("https://oauth.onshape.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: ONSHAPE_CLIENT_ID,
        client_secret: ONSHAPE_CLIENT_SECRET
      })
    });

    if (!response.ok) {
      throw new Error(
        `Onshape token refresh failed (${response.status}): ${await response.text()}`
      );
    }

    return response.json();
  }
}

export async function getOnshapeClient(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string
): Promise<
  { client: OnshapeClient; error: null } | { client: null; error: string }
> {
  const integration = await client
    .from("companyIntegration")
    .select("*")
    .eq("id", "onshape")
    .eq("companyId", companyId)
    .maybeSingle();

  if (integration.error || !integration.data) {
    return { client: null, error: "Onshape integration not found" };
  }

  const metadata = integration.data.metadata as Record<string, any>;
  const credentials = metadata?.credentials;

  if (!credentials?.accessToken) {
    return { client: null, error: "Onshape credentials not found" };
  }

  let accessToken = credentials.accessToken;
  const baseUrl = metadata?.baseUrl ?? "https://cad.onshape.com";

  // Refresh token if expired
  if (
    credentials.expiresAt &&
    credentials.refreshToken &&
    new Date(credentials.expiresAt) <= new Date()
  ) {
    try {
      const refreshed = await OnshapeClient.refreshAccessToken(
        credentials.refreshToken
      );

      accessToken = refreshed.access_token;

      // Persist the new tokens
      await client
        .from("companyIntegration")
        .update({
          metadata: {
            ...metadata,
            credentials: {
              ...credentials,
              accessToken: refreshed.access_token,
              refreshToken: refreshed.refresh_token,
              expiresAt: new Date(Date.now() + 3600 * 1000).toISOString()
            }
          },
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .eq("id", "onshape")
        .eq("companyId", companyId);
    } catch (error) {
      console.error("Failed to refresh Onshape token:", error);
      return { client: null, error: "Failed to refresh Onshape token" };
    }
  }

  return {
    client: new OnshapeClient({ baseUrl, accessToken }),
    error: null
  };
}
