import { getCarbonServiceRole } from "@carbon/auth";
import axios, { isAxiosError, type AxiosInstance } from "axios";
import type z from "zod";
import type { LinearIssueSchema } from "./service";
import { getLinearIntegration } from "./service";
import type { LinearWorkStateType } from "./utils";

export type LinearIssue = z.infer<typeof LinearIssueSchema>;

export interface LinearTeam {
  id: string;
  name: string;
}

export interface LinearUser {
  id: string;
  email: string;
  name: string;
}
export class LinearClient {
  instance: AxiosInstance;

  constructor() {
    this.instance = axios.create({
      baseURL: "https://api.linear.app/graphql",
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  async getAuthHeaders(companyId: string) {
    const serviceRole = getCarbonServiceRole();

    const { data } = await getLinearIntegration(serviceRole, companyId);

    const integration = data?.[0];

    if (!integration) {
      throw new Error("Linear integration not found for company");
    }

    const metadata = integration.metadata as { apiKey: string };

    return {
      Authorization: metadata.apiKey,
    };
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
          query,
        },
      });

      return response.data.data.teams.nodes.map((el) => el);
    } catch (error) {
      console.error("Error listing Linear teams:", error);
      return [];
    }
  }

  async listIssues(companyId: string, input: string) {
    try {
      const query = `query SearchIssues($term : String!) { searchIssues(term: $term, first: 5, orderBy: updatedAt) { nodes { id identifier title description state { name type color } url assignee { email } } } }`;

      const response = await this.instance.request<{
        data: { searchIssues: { nodes: LinearIssue[] } };
      }>({
        method: "POST",
        headers: await this.getAuthHeaders(companyId),
        data: {
          query,
          variables: {
            term: input,
          },
        },
      });

      return response.data.data.searchIssues.nodes.map((el) => el);
    } catch (error) {
      console.error("Error listing Linear issues:", error);
      return [];
    }
  }

  async getIssueById(companyId: string, issueId: string) {
    try {
      const query = `query SearchIssues($filter: IssueFilter!) { issues( filter: $filter first: 1 orderBy: updatedAt ) { nodes { id identifier title dueDate description state { name type color } url assignee { email } } } }`;

      const response = await this.instance.request<{
        data: { issues: { nodes: LinearIssue[] } };
      }>({
        method: "POST",
        headers: await this.getAuthHeaders(companyId),
        data: {
          query,
          variables: { filter: { id: { eq: issueId } } },
        },
      });

      return response.data.data.issues.nodes.at(0) || null;
    } catch (error) {
      if (isAxiosError(error)) {
        console.dir(error.response.data, { depth: null });
        console.dir(error.config.data, { depth: null });
      }
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
          input,
        },
      },
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
          variables: { teamId },
        },
      });

      return response.data.data.team.members.nodes.map((el) => el);
    } catch (error) {
      console.error("Error listing Linear team members:", error);
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
    const query = `mutation IssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) { issue { id identifier title dueDate description state { name type color } url assignee { email } } } }`;

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
          input: data,
        },
      },
    });

    return response.data.data.issueCreate.issue;
  }

  async getUsers(companyId: string, filter: { email?: string; id?: string }) {
    const query = `query Users($filter: UserFilter) { users(filter: $filter) { edges { node { id email } } } }`;

    const response = await this.instance.request<{
      data: { users: { edges: Array<{ node: LinearUser }> } };
    }>({
      method: "POST",
      headers: await this.getAuthHeaders(companyId),
      data: {
        query,
        variables: { input: filter },
      },
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
            input,
          },
        },
      });

      return response.data.data.issueUpdate.issue;
    } catch (error) {
      if (isAxiosError(error)) {
        console.dir(error.response.data, { depth: null });
        console.dir(error.config.data, { depth: null });
      }
    }
  }

  async getWorkflowState(companyId: string, type: LinearWorkStateType) {
    const query = `query GetWorkflowState($filter: WorkflowStateFilter) { workflowStates(filter: $filter ) { nodes { id name color type } } }`;
    const res = await this.instance.request<{
      data: {
        workflowStates: {
          nodes: Array<{
            id: string;
            name: string;
            color: string;
            type: string;
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
            type: { eq: type },
          },
        },
      },
    });

    return res.data.data.workflowStates.nodes.at(0) || null;
  }
}
