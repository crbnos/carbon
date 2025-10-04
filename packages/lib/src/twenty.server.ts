type TwentyPersonInput = {
  name: {
    firstName: string;
    lastName: string;
  };
  emails: {
    primaryEmail: string;
  };
  customerStatus: string[];
  location?: string;
};

type TwentyCompanyInput = {
  name: string;
  domainName?: {
    primaryLinkLabel?: string;
    primaryLinkUrl?: string;
    additionalLinks: string[];
  };
};

type TwentyOpportunityInput = {
  name: string;
  stage: string[];
  companyId: string;
  pointOfContactId: string;
};

type TwentyPersonResponse = {
  data: { createPerson: { id: string } };
};

type TwentyCompanyResponse = {
  data: { createCompany: { id: string } };
};

type TwentyOpportunityResponse = {
  data: { createOpportunity: { id: string } };
};

class TwentyClient {
  private apiKey: string;
  private baseUrl = "https://api.twenty.com/rest";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async request<T>(
    endpoint: string,
    method: "GET" | "POST" | "PUT" | "DELETE",
    body?: unknown
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Twenty CRM API error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    return response.json() as Promise<T>;
  }

  async createPerson(data: TwentyPersonInput): Promise<string> {
    const response = await this.request<TwentyPersonResponse>(
      "/people",
      "POST",
      data
    );
    return response.data.createPerson.id;
  }

  async updatePerson(
    personId: string,
    data: Partial<TwentyPersonInput>
  ): Promise<void> {
    await this.request(`/people/${personId}`, "PUT", data);
  }

  async createCompany(data: TwentyCompanyInput): Promise<string> {
    const response = await this.request<TwentyCompanyResponse>(
      "/companies",
      "POST",
      data
    );
    return response.data.createCompany.id;
  }

  async createOpportunity(data: TwentyOpportunityInput): Promise<string> {
    const response = await this.request<TwentyOpportunityResponse>(
      "/opportunities",
      "POST",
      data
    );
    return response.data.createOpportunity.id;
  }
}

export const getTwentyClient = () => {
  const apiKey = process.env.TWENTY_API_KEY;
  if (!apiKey) {
    throw new Error("TWENTY_API_KEY environment variable is not set");
  }
  return new TwentyClient(apiKey);
};

export const twentyClient = new TwentyClient(process.env.TWENTY_API_KEY!);
