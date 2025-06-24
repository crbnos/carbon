import axios from "axios";

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
  private axiosInstance: ReturnType<typeof axios.create>;

  constructor(config: OnshapeClientConfig) {
    this.baseUrl = config.baseUrl;
    this.accessKey = config.accessKey;
    this.secretKey = config.secretKey;

    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      headers: this.getAuthHeaders(),
    });
  }

  /**
   * Generate the authorization headers for Onshape API requests
   */
  private getAuthHeaders(): Record<string, string> {
    const auth = Buffer.from(`${this.accessKey}:${this.secretKey}`).toString(
      "base64"
    );

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
    try {
      const response = await this.axiosInstance.request<T>({
        method,
        url: path,
        data: body,
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.log("Onshape API error headers:", error.config?.headers);
        throw new Error(
          `Onshape API error (${error.response?.status}): ${error.response?.data}`
        );
      }
      throw error;
    }
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
