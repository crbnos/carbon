// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import axios, { type AxiosInstance } from "axios";
import { resolveIntegrationSecrets } from "../../integrations/secrets";
import { getLinearIntegration } from "./service";
import type { LinearIssue, LinearTeam, LinearUser } from "./types";
import type { LinearWorkStateType } from "./utils";

const logger = getLogger("ee", "linear");

function toUserFilter(filter: { email?: string; id?: string }) {
  return {
    ...(filter.email ? { email: { eqIgnoreCase: filter.email } } : {}),
    ...(filter.id ? { id: { eq: filter.id } } : {})
  };
}

export class LinearClient {
  instance: AxiosInstance;

  constructor() {
    this.instance = axios.create({
      baseURL: "https://api.linear.app/graphql",
      headers: {
        "Content-Type": "application/json"
      }
    });
  }

  async getAuthHeaders(companyId: string) {
    const serviceRole = getCarbonServiceRole();

    const { data } = await getLinearIntegration(serviceRole, companyId);

    const integration = data?.[0];

    if (!integration) {
      throw new Error("Linear integration not found for company");
    }

    // Secret material lives in Supabase Vault; merge it back so we read the
    // apiKey the same as before. Vault RPCs require the service-role client.
    const metadata = (await resolveIntegrationSecrets(
      serviceRole,
      companyId,
      "linear",
      integration.metadata,
      integration.secretRef
    )) as { apiKey: string };

    return {
      Authorization: metadata.apiKey
    };
  }

  async healthcheck(companyId: string) {
    try {
      const response = await this.instance.request({
        method: "POST",
        headers: await this.getAuthHeaders(companyId),
        data: {
          query: `query { viewer { id } }`
        }
      });

      return response.status === 200 && !response.data.errors?.length;
    } catch {
      return false;
    }
  }

  async listTeams(companyId: string) {
    try {
      const query = `query Teams { teams { nodes { id name } } }`;

      const response = await this.instance.request<{
        data: { teams: { nodes: LinearTeam[] } };
      }>({
        method: "POST",
        headers: await this.getAuthHeaders(companyId),
        data: {
          query
        }
      });

      return response.data.data.teams.nodes.map((el) => el);
    } catch (error) {
      logger.error("Error listing Linear teams", { error });
      return [];
    }
  }

  async listIssues(companyId: string, input: string) {
    try {
      const query = `query SearchIssues($term : String!) { searchIssues(term: $term, first: 5, orderBy: updatedAt) { nodes { id identifier title priority description state { name type color } url assignee { email } team { id } } } }`;

      const response = await this.instance.request<{
        data: { searchIssues: { nodes: LinearIssue[] } };
      }>({
        method: "POST",
        headers: await this.getAuthHeaders(companyId),
        data: {
          query,
          variables: {
            term: input
          }
        }
      });

      return response.data.data.searchIssues.nodes.map((el) => el);
    } catch (error) {
      logger.error("Error listing Linear issues", { error });
      return [];
    }
  }

  async getIssueById(companyId: string, issueId: string) {
    try {
      const query = `query SearchIssues($filter: IssueFilter!) { issues( filter: $filter first: 1 orderBy: updatedAt ) { nodes { id identifier title dueDate priority description state { name type color } url assignee { email } team { id } } } }`;

      const response = await this.instance.request<{
        data: { issues: { nodes: LinearIssue[] } };
      }>({
        method: "POST",
        headers: await this.getAuthHeaders(companyId),
        data: {
          query,
          variables: { filter: { id: { eq: issueId } } }
        }
      });

      return response.data.data.issues.nodes.at(0) || null;
    } catch (error) {
      logger.error("Error getting Linear issue by ID", { error });
      return null;
    }
  }

  async createAttachmentLink(
    companyId: string,
    input: { issueId: string; title: string; url: string }
  ) {
    const query = `mutation AttachmentCreate($input: AttachmentCreateInput!) { attachmentCreate(input: $input) { attachment { id } } }`;

    const response = await this.instance.request<{
      data: { issues: { nodes: LinearIssue[] } };
    }>({
      method: "POST",
      headers: await this.getAuthHeaders(companyId),
      data: {
        query,
        variables: {
          input
        }
      }
    });

    return response.data;
  }

  async listTeamMembers(companyId: string, teamId: string) {
    try {
      const query = `query Team($teamId: String!) { team(id: $teamId) { members { nodes { id email name } } } }`;

      const response = await this.instance.request<{
        data: { team: { members: { nodes: LinearUser[] } } };
      }>({
        method: "POST",
        headers: await this.getAuthHeaders(companyId),
        data: {
          query,
          variables: { teamId }
        }
      });

      return response.data.data.team.members.nodes.map((el) => el);
    } catch (error) {
      logger.error("Error listing Linear team members", { error });
      return [];
    }
  }

  async createIssue(
    companyId: string,
    data: {
      title: string;
      description?: string;
      teamId: string;
      assigneeId?: string | null;
    }
  ) {
    const query = `mutation IssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) { issue { id identifier title dueDate priority description state { name type color } url assignee { email } team { id } } } }`;

    const response = await this.instance.request<{
      data: {
        issueCreate: {
          issue: LinearIssue;
        };
      };
    }>({
      method: "POST",
      headers: await this.getAuthHeaders(companyId),
      data: {
        query,
        variables: {
          input: data
        }
      }
    });

    return response.data.data.issueCreate.issue;
  }

  async getUsers(companyId: string, filter: { email?: string; id?: string }) {
    if (!filter.email && !filter.id) return [];

    const query = `query Users($filter: UserFilter) { users(filter: $filter) { edges { node { id email } } } }`;

    const response = await this.instance.request<{
      data: { users: { edges: Array<{ node: LinearUser }> } };
    }>({
      method: "POST",
      headers: await this.getAuthHeaders(companyId),
      data: {
        query,
        variables: { filter: toUserFilter(filter) }
      }
    });

    return response.data.data.users.edges.map((el) => el.node);
  }

  async updateIssue(
    companyId: string,
    data: {
      id: string;
      title?: string;
      description?: string;
      assigneeId?: string | null;
      stateId?: string;
      priority?: number;
      dueDate?: string | null;
    }
  ) {
    try {
      const query = `mutation IssueUpdate($issueUpdateId: String!, $input: IssueUpdateInput!) { issueUpdate(id: $issueUpdateId, input: $input) { issue { id } } }`;
      const { id, ...input } = data;

      const response = await this.instance.request<{
        data: {
          issueUpdate: {
            issue: { id: string };
          };
        };
      }>({
        method: "POST",
        headers: await this.getAuthHeaders(companyId),
        data: {
          query,
          variables: {
            issueUpdateId: id,
            input
          }
        }
      });

      return response.data.data.issueUpdate.issue;
    } catch (error) {
      logger.error("Error updating Linear issue", { error });
      return null;
    }
  }

  async getWorkflowState(
    companyId: string,
    teamId: string,
    type: LinearWorkStateType
  ) {
    const query = `query GetWorkflowState($filter: WorkflowStateFilter) { workflowStates(filter: $filter ) { nodes { id name color type position } } }`;
    const res = await this.instance.request<{
      data: {
        workflowStates: {
          nodes: Array<{
            id: string;
            name: string;
            color: string;
            type: string;
            position: number;
          }>;
        };
      };
    }>({
      method: "POST",
      headers: await this.getAuthHeaders(companyId),
      data: {
        query,
        variables: {
          filter: {
            team: { id: { eq: teamId } },
            type: { eq: type }
          }
        }
      }
    });

    // A team can have several states of one type; the first by position is
    // the one Linear lists first in that column.
    const nodes = [...res.data.data.workflowStates.nodes].sort(
      (a, b) => a.position - b.position
    );
    return nodes.at(0) || null;
  }

  async listAttachments(companyId: string, url: string) {
    try {
      const query = `query Query($filter: AttachmentFilter) { attachments(filter: $filter, first: 1) { nodes { id url } } }`;

      const res = await this.instance.request<{
        data: {
          attachments: {
            nodes: Array<{
              id: string;
              url: string;
            }>;
          };
        };
      }>({
        method: "POST",
        headers: await this.getAuthHeaders(companyId),
        data: {
          query,
          variables: {
            filter: {
              url: { contains: url }
            }
          }
        }
      });

      return res.data.data.attachments.nodes.map((el) => el);
    } catch (error) {
      logger.error("Error listing Linear attachments", { error });
      return [];
    }
  }

  /** Remove the Carbon back-link (an attachment with this URL) from one issue. */
  async removeIssueLink(companyId: string, issueId: string, url: string) {
    try {
      const query = `query IssueAttachments($id: String!, $filter: AttachmentFilter) { issue(id: $id) { attachments(filter: $filter) { nodes { id } } } }`;

      const res = await this.instance.request<{
        data: { issue: { attachments: { nodes: Array<{ id: string }> } } };
      }>({
        method: "POST",
        headers: await this.getAuthHeaders(companyId),
        data: {
          query,
          variables: { id: issueId, filter: { url: { eq: url } } }
        }
      });

      for (const node of res.data.data.issue?.attachments.nodes ?? []) {
        await this.removeAttachment(companyId, node.id);
      }
    } catch (error) {
      logger.error("Error removing the Linear back-link", { error });
    }
  }

  async removeAttachment(companyId: string, attachmentId: string) {
    try {
      const query = `mutation AttachmentDelete($attachmentDeleteId: String!) { attachmentDelete(id: $attachmentDeleteId) { success } }`;

      const response = await this.instance.request<{
        data: {
          attachmentDelete: {
            success: boolean;
          };
        };
      }>({
        method: "POST",
        headers: await this.getAuthHeaders(companyId),
        validateStatus: (status) => status === 200 || status === 404,
        data: {
          query,
          variables: {
            attachmentDeleteId: attachmentId
          }
        }
      });

      return response.data.data.attachmentDelete.success;
    } catch (error) {
      logger.error("Error removing Linear attachment", { error });
      return false;
    }
  }
}

let instance: LinearClient | null = null;

export const getLinearClient = () => {
  if (!instance) instance = new LinearClient();
  return instance;
};
