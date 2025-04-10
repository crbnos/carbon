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
  private getAuthHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "application/json;charset=UTF-8; qs=0.09",
      Authorization: `Basic ${btoa(`${this.accessKey}:${this.secretKey}`)}`,
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
    const headers = this.getAuthHeaders();
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

  async getElements(documentId: string, versionId: string): Promise<any> {
    return this.request(
      "GET",
      `/api/v10/documents/d/${documentId}/v/${versionId}/elements`
    );
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
