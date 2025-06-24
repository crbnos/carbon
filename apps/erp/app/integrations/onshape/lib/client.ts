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
    const auth = Buffer.from(`${this.accessKey}:${this.secretKey}`).toString(
      "base64"
    );
    console.log("onshapedauth", auth);
    return {
      "Content-Type": "application/json",
      Accept: "application/json;charset=UTF-8; qs=0.09",
      Authorization: `Basic ${auth}`,
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
    console.log("onshapedurl", url);

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log("Onshape API error headers:", headers);
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
}
