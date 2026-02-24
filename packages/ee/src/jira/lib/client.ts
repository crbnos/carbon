import {
  getCarbonServiceRole,
  JIRA_CLIENT_ID,
  JIRA_CLIENT_SECRET
} from "@carbon/auth";
import { getJiraIntegration, updateJiraCredentials } from "./service";
import type {
  CreateJiraIssueInput,
  JiraAccessibleResource,
  JiraCredentials,
  JiraIssue,
  JiraIssueType,
  JiraProject,
  JiraRemoteLink,
  JiraStatusCategory,
  JiraTransition,
  JiraUser,
  UpdateJiraIssueInput
} from "./types";

const ATLASSIAN_AUTH_URL = "https://auth.atlassian.com";
const ATLASSIAN_API_URL = "https://api.atlassian.com";

/**
 * Exchange authorization code for access and refresh tokens.
 */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string
): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
} | null> {
  try {
    const response = await fetch(`${ATLASSIAN_AUTH_URL}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: JIRA_CLIENT_ID,
        client_secret: JIRA_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri
      })
    });

    if (!response.ok) {
      console.error(
        "Failed to exchange code for tokens:",
        response.status,
        await response.text()
      );
      return null;
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in
    };
  } catch (e) {
    console.error("Error exchanging code for tokens:", e);
    return null;
  }
}

/**
 * Refresh access token using refresh token.
 */
export async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
} | null> {
  try {
    const response = await fetch(`${ATLASSIAN_AUTH_URL}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: JIRA_CLIENT_ID,
        client_secret: JIRA_CLIENT_SECRET,
        refresh_token: refreshToken
      })
    });

    if (!response.ok) {
      console.error(
        "Failed to refresh token:",
        response.status,
        await response.text()
      );
      return null;
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in
    };
  } catch (e) {
    console.error("Error refreshing token:", e);
    return null;
  }
}

/**
 * Get accessible Jira Cloud resources for the authenticated user.
 * This is called during OAuth to get the cloudId.
 */
export async function getAccessibleResources(
  accessToken: string
): Promise<JiraAccessibleResource[]> {
  try {
    const response = await fetch(
      `${ATLASSIAN_API_URL}/oauth/token/accessible-resources`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json"
        }
      }
    );

    if (!response.ok) {
      console.error(
        "Failed to get accessible resources:",
        response.status,
        await response.text()
      );
      return [];
    }

    return (await response.json()) as JiraAccessibleResource[];
  } catch (e) {
    console.error("Error getting accessible resources:", e);
    return [];
  }
}

/**
 * Jira Cloud REST API client.
 */
export class JiraClient {
  /**
   * Get authentication headers, refreshing token if needed.
   */
  async getAuthHeaders(companyId: string): Promise<Record<string, string>> {
    const serviceRole = getCarbonServiceRole();
    const { data } = await getJiraIntegration(serviceRole, companyId);
    const integration = data?.[0];

    if (!integration) {
      throw new Error("Jira integration not found for company");
    }

    const metadata = integration.metadata as { credentials: JiraCredentials };
    const credentials = metadata.credentials;

    // Check if token needs refresh (5 min buffer)
    const now = Date.now();
    if (credentials.expiresAt - now < 5 * 60 * 1000) {
      const refreshed = await refreshAccessToken(credentials.refreshToken);
      if (refreshed) {
        const newCredentials: JiraCredentials = {
          ...credentials,
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          expiresAt: now + refreshed.expiresIn * 1000
        };

        // Update stored credentials
        await updateJiraCredentials(serviceRole, companyId, newCredentials);

        return {
          Authorization: `Bearer ${refreshed.accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json"
        };
      }
    }

    return {
      Authorization: `Bearer ${credentials.accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    };
  }

  /**
   * Get the cloud ID for API requests.
   */
  async getCloudId(companyId: string): Promise<string> {
    const serviceRole = getCarbonServiceRole();
    const { data } = await getJiraIntegration(serviceRole, companyId);
    const integration = data?.[0];

    if (!integration) {
      throw new Error("Jira integration not found for company");
    }

    const metadata = integration.metadata as { credentials: JiraCredentials };
    return metadata.credentials.cloudId;
  }

  /**
   * Get the site URL for linking.
   */
  async getSiteUrl(companyId: string): Promise<string> {
    const serviceRole = getCarbonServiceRole();
    const { data } = await getJiraIntegration(serviceRole, companyId);
    const integration = data?.[0];

    if (!integration) {
      throw new Error("Jira integration not found for company");
    }

    const metadata = integration.metadata as { credentials: JiraCredentials };
    return metadata.credentials.siteUrl;
  }

  /**
   * Make an API request to Jira Cloud.
   */
  async request<T>(
    companyId: string,
    path: string,
    options?: RequestInit
  ): Promise<T> {
    const headers = await this.getAuthHeaders(companyId);
    const cloudId = await this.getCloudId(companyId);

    const response = await fetch(
      `${ATLASSIAN_API_URL}/ex/jira/${cloudId}/rest/api/3${path}`,
      {
        ...options,
        headers: {
          ...headers,
          ...(options?.headers || {})
        }
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Jira API error (${path}):`, response.status, errorText);
      throw new Error(`Jira API error: ${response.status}`);
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return {} as T;
    }

    return response.json();
  }

  /**
   * Health check - verify the integration is working.
   */
  async healthcheck(companyId: string): Promise<boolean> {
    try {
      await this.request(companyId, "/myself");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List all projects accessible to the user.
   */
  async listProjects(companyId: string): Promise<JiraProject[]> {
    try {
      const response = await this.request<{ values: JiraProject[] }>(
        companyId,
        "/project/search?maxResults=50"
      );
      return response.values || [];
    } catch (e) {
      console.error("Error listing Jira projects:", e);
      return [];
    }
  }

  /**
   * Get issue types for a project.
   */
  async getIssueTypes(
    companyId: string,
    projectKey: string
  ): Promise<JiraIssueType[]> {
    try {
      const response = await this.request<{ issueTypes: JiraIssueType[] }>(
        companyId,
        `/project/${projectKey}`
      );
      return (response.issueTypes || []).filter((t) => !t.subtask);
    } catch (e) {
      console.error("Error getting Jira issue types:", e);
      return [];
    }
  }

  /**
   * Get users assignable to a project.
   */
  async listProjectUsers(
    companyId: string,
    projectKey: string
  ): Promise<JiraUser[]> {
    try {
      return await this.request<JiraUser[]>(
        companyId,
        `/user/assignable/search?project=${projectKey}&maxResults=50`
      );
    } catch (e) {
      console.error("Error listing Jira project users:", e);
      return [];
    }
  }

  /**
   * Search for issues using JQL.
   */
  async searchIssues(companyId: string, query: string): Promise<JiraIssue[]> {
    try {
      // Escape special characters in query for JQL text search
      const escapedQuery = query.replace(/['"\\]/g, "\\$&");
      const jql = `text ~ "${escapedQuery}" ORDER BY updated DESC`;

      const response = await this.request<{ issues: JiraIssue[] }>(
        companyId,
        `/search/jql?jql=${encodeURIComponent(
          jql
        )}&maxResults=10&fields=summary,description,status,assignee,duedate,issuetype,project,priority`
      );
      return response.issues || [];
    } catch (e) {
      console.error("Error searching Jira issues:", e);
      return [];
    }
  }

  /**
   * Get a single issue by ID or key.
   */
  async getIssue(
    companyId: string,
    issueIdOrKey: string
  ): Promise<JiraIssue | null> {
    try {
      return await this.request<JiraIssue>(
        companyId,
        `/issue/${issueIdOrKey}?fields=summary,description,status,assignee,duedate,issuetype,project,priority`
      );
    } catch (e) {
      console.error("Error getting Jira issue:", e);
      return null;
    }
  }

  /**
   * Create a new issue.
   */
  async createIssue(
    companyId: string,
    input: CreateJiraIssueInput
  ): Promise<JiraIssue | null> {
    try {
      const fields: Record<string, any> = {
        project: { key: input.projectKey },
        issuetype: { id: input.issueTypeId },
        summary: input.summary
      };

      if (input.description) {
        fields.description = input.description;
      }

      if (input.assigneeId) {
        fields.assignee = { accountId: input.assigneeId };
      }

      if (input.priority) {
        fields.priority = { name: input.priority };
      }

      const response = await this.request<{ id: string; key: string }>(
        companyId,
        "/issue",
        {
          method: "POST",
          body: JSON.stringify({ fields })
        }
      );

      // Fetch the full issue details
      return this.getIssue(companyId, response.key);
    } catch (e) {
      console.error("Error creating Jira issue:", e);
      return null;
    }
  }

  /**
   * Update an existing issue.
   */
  async updateIssue(
    companyId: string,
    issueId: string,
    input: UpdateJiraIssueInput
  ): Promise<void> {
    try {
      const fields: Record<string, any> = {};

      if (input.summary !== undefined) {
        fields.summary = input.summary;
      }

      if (input.description !== undefined) {
        fields.description = input.description;
      }

      if (input.assigneeId !== undefined) {
        fields.assignee = input.assigneeId
          ? { accountId: input.assigneeId }
          : null;
      }

      if (input.priority !== undefined) {
        fields.priority = { name: input.priority };
      }

      await this.request(companyId, `/issue/${issueId}`, {
        method: "PUT",
        body: JSON.stringify({ fields })
      });
    } catch (e) {
      console.error("Error updating Jira issue:", e);
    }
  }

  /**
   * Get available transitions for an issue.
   */
  async getTransitions(
    companyId: string,
    issueId: string
  ): Promise<JiraTransition[]> {
    try {
      const response = await this.request<{ transitions: JiraTransition[] }>(
        companyId,
        `/issue/${issueId}/transitions`
      );
      return response.transitions || [];
    } catch (e) {
      console.error("Error getting Jira transitions:", e);
      return [];
    }
  }

  /**
   * Transition an issue to a status matching the target category.
   */
  async transitionIssue(
    companyId: string,
    issueId: string,
    targetCategory: JiraStatusCategory
  ): Promise<boolean> {
    try {
      const transitions = await this.getTransitions(companyId, issueId);

      // Find a transition that leads to the target status category
      const transition = transitions.find(
        (t) => t.to.statusCategory.key === targetCategory
      );

      if (!transition) {
        console.warn(
          `No transition found to ${targetCategory} for issue ${issueId}`
        );
        return false;
      }

      await this.request(companyId, `/issue/${issueId}/transitions`, {
        method: "POST",
        body: JSON.stringify({ transition: { id: transition.id } })
      });

      return true;
    } catch (e) {
      console.error("Error transitioning Jira issue:", e);
      return false;
    }
  }

  /**
   * Create a remote link (backlink to Carbon).
   */
  async createRemoteLink(
    companyId: string,
    issueId: string,
    url: string,
    title: string
  ): Promise<JiraRemoteLink | null> {
    try {
      return await this.request<JiraRemoteLink>(
        companyId,
        `/issue/${issueId}/remotelink`,
        {
          method: "POST",
          body: JSON.stringify({
            globalId: `carbon-${url}`,
            application: {
              type: "com.carbon.ms",
              name: "Carbon"
            },
            object: {
              url,
              title
            }
          })
        }
      );
    } catch (e) {
      console.error("Error creating Jira remote link:", e);
      return null;
    }
  }

  /**
   * Get remote links for an issue.
   */
  async getRemoteLinks(
    companyId: string,
    issueId: string
  ): Promise<JiraRemoteLink[]> {
    try {
      return await this.request<JiraRemoteLink[]>(
        companyId,
        `/issue/${issueId}/remotelink`
      );
    } catch (e) {
      console.error("Error getting Jira remote links:", e);
      return [];
    }
  }

  /**
   * Delete a remote link by global ID.
   */
  async deleteRemoteLink(
    companyId: string,
    issueId: string,
    globalId: string
  ): Promise<boolean> {
    try {
      await this.request(
        companyId,
        `/issue/${issueId}/remotelink?globalId=${encodeURIComponent(globalId)}`,
        { method: "DELETE" }
      );
      return true;
    } catch (e) {
      console.error("Error deleting Jira remote link:", e);
      return false;
    }
  }

  /**
   * Find users by email.
   */
  async findUserByEmail(
    companyId: string,
    email: string
  ): Promise<JiraUser | null> {
    try {
      const users = await this.request<JiraUser[]>(
        companyId,
        `/user/search?query=${encodeURIComponent(email)}&maxResults=1`
      );
      return users.length > 0 ? users[0] : null;
    } catch (e) {
      console.error("Error finding Jira user:", e);
      return null;
    }
  }
}

let instance: JiraClient | null = null;

export const getJiraClient = () => {
  if (!instance) instance = new JiraClient();
  return instance;
};
