import { z } from "zod";

interface OnshapeClientConfig {
  baseUrl: string;
  accessKey: string;
  secretKey: string;
}

export interface OnshapePart {
  id: string;
  name: string;
  partNumber: string;
  revision: string;
  description: string;
  metadata: Record<string, string>;
}

const OnshapePartSchema = z.object({
  id: z.string(),
  name: z.string(),
  partNumber: z.string().optional().default(""),
  revision: z.string().optional().default(""),
  description: z.string().optional().default(""),
  metadata: z.record(z.string()).optional().default({}),
});

export class OnshapeClient {
  private baseUrl: string;
  private accessKey: string;
  private secretKey: string;

  constructor(config: OnshapeClientConfig) {
    this.baseUrl = config.baseUrl;
    this.accessKey = config.accessKey;
    this.secretKey = config.secretKey;
  }

  /**
   * Generate the authorization headers for Onshape API requests
   */
  private getAuthHeaders(
    method: string,
    path: string,
    date: string
  ): Record<string, string> {
    const hmacString = `${method}\n${date}\n${path}\n`;
    const hmac = require("crypto").createHmac("sha256", this.secretKey);
    hmac.update(hmacString);
    const signature = hmac.digest("base64");

    return {
      Date: date,
      "Content-Type": "application/json",
      Authorization: `On ${this.accessKey}:${signature}`,
    };
  }

  /**
   * Make an authenticated request to the Onshape API
   */
  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const date = new Date().toUTCString();
    const headers = this.getAuthHeaders(method, path, date);
    const url = `${this.baseUrl}${path}`;

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Onshape API error (${response.status}): ${errorText}`);
    }

    return response.json();
  }

  /**
   * Get a list of documents
   */
  async getDocuments(): Promise<any> {
    return this.request("GET", "/api/documents");
  }

  /**
   * Get a specific document by ID
   */
  async getDocument(documentId: string): Promise<any> {
    return this.request("GET", `/api/documents/${documentId}`);
  }

  /**
   * Get parts from a specific document
   */
  async getParts(
    documentId: string,
    workspaceId: string
  ): Promise<OnshapePart[]> {
    const response = await this.request<any>(
      "GET",
      `/api/documents/${documentId}/workspaces/${workspaceId}/parts`
    );

    return response.map((part: any) =>
      OnshapePartSchema.parse({
        id: part.partId,
        name: part.name,
        partNumber: part.partNumber,
        revision: part.revision,
        description: part.description,
        metadata: part.properties || {},
      })
    );
  }

  /**
   * Get a specific part by ID
   */
  async getPart(
    documentId: string,
    workspaceId: string,
    elementId: string,
    partId: string
  ): Promise<OnshapePart> {
    const response = await this.request<any>(
      "GET",
      `/api/parts/d/${documentId}/w/${workspaceId}/e/${elementId}/partid/${partId}`
    );

    return OnshapePartSchema.parse({
      id: response.id,
      name: response.name,
      partNumber: response.partNumber,
      revision: response.revision,
      description: response.description,
      metadata: response.properties || {},
    });
  }

  /**
   * Sync a part from Onshape to Carbon
   */
  async syncPart(part: OnshapePart): Promise<void> {
    // Implementation would depend on how Carbon expects to receive the part data
    console.log(`Syncing part ${part.name} (${part.id}) to Carbon`);
    // This would typically involve transforming the Onshape part data
    // and then sending it to a Carbon API endpoint
  }

  /**
   * Sync all parts from a document to Carbon
   */
  async syncAllParts(documentId: string, workspaceId: string): Promise<void> {
    const parts = await this.getParts(documentId, workspaceId);

    for (const part of parts) {
      await this.syncPart(part);
    }

    console.log(
      `Synced ${parts.length} parts from document ${documentId} to Carbon`
    );
  }
}
