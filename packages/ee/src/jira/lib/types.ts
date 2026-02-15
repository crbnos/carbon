import { z } from "zod";

/**
 * Jira status category - used for status mapping
 * Jira organizes statuses into these three categories
 */
export type JiraStatusCategory = "new" | "indeterminate" | "done";

/**
 * Jira issue status
 */
export const JiraStatusSchema = z.object({
  id: z.string(),
  name: z.string(),
  statusCategory: z.object({
    id: z.number(),
    key: z.enum(["new", "indeterminate", "done"]),
    name: z.string()
  })
});

export type JiraStatus = z.infer<typeof JiraStatusSchema>;

/**
 * Jira user (assignee)
 */
export const JiraUserSchema = z.object({
  accountId: z.string(),
  emailAddress: z.string().optional(),
  displayName: z.string(),
  avatarUrls: z
    .object({
      "48x48": z.string().optional()
    })
    .optional()
});

export type JiraUser = z.infer<typeof JiraUserSchema>;

/**
 * Jira issue - the main entity we work with
 */
export const JiraIssueSchema = z.object({
  id: z.string(),
  key: z.string(),
  self: z.string().optional(),
  fields: z.object({
    summary: z.string(),
    description: z.any().nullable(), // ADF format
    status: JiraStatusSchema,
    assignee: JiraUserSchema.nullable(),
    duedate: z.string().nullable().optional(),
    issuetype: z
      .object({
        id: z.string(),
        name: z.string(),
        iconUrl: z.string().optional()
      })
      .optional(),
    project: z
      .object({
        id: z.string(),
        key: z.string(),
        name: z.string()
      })
      .optional(),
    priority: z
      .object({
        id: z.string(),
        name: z.string()
      })
      .optional()
  })
});

export type JiraIssue = z.infer<typeof JiraIssueSchema>;

/**
 * Simplified Jira issue for external mapping storage
 */
export const JiraIssueMappingSchema = z.object({
  id: z.string(),
  key: z.string(),
  summary: z.string(),
  url: z.string(),
  status: z.object({
    name: z.string(),
    category: z.enum(["new", "indeterminate", "done"])
  }),
  assignee: z
    .object({
      emailAddress: z.string().optional(),
      displayName: z.string()
    })
    .nullable()
});

export type JiraIssueMapping = z.infer<typeof JiraIssueMappingSchema>;

/**
 * Jira project
 */
export const JiraProjectSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  avatarUrls: z
    .object({
      "48x48": z.string().optional()
    })
    .optional()
});

export type JiraProject = z.infer<typeof JiraProjectSchema>;

/**
 * Jira issue type (Task, Bug, Story, etc.)
 */
export const JiraIssueTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  iconUrl: z.string().optional(),
  subtask: z.boolean()
});

export type JiraIssueType = z.infer<typeof JiraIssueTypeSchema>;

/**
 * Jira transition (for changing issue status)
 */
export const JiraTransitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  to: JiraStatusSchema
});

export type JiraTransition = z.infer<typeof JiraTransitionSchema>;

/**
 * Jira OAuth credentials stored in companyIntegration.metadata
 */
export interface JiraCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  cloudId: string;
  siteUrl: string;
}

/**
 * Jira accessible resource (returned from OAuth flow)
 */
export const JiraAccessibleResourceSchema = z.object({
  id: z.string(),
  url: z.string(),
  name: z.string(),
  scopes: z.array(z.string()),
  avatarUrl: z.string().optional()
});

export type JiraAccessibleResource = z.infer<
  typeof JiraAccessibleResourceSchema
>;

/**
 * Jira remote link (for backlinks from Jira to Carbon)
 */
export const JiraRemoteLinkSchema = z.object({
  id: z.number(),
  self: z.string(),
  globalId: z.string(),
  application: z.object({
    type: z.string().optional(),
    name: z.string().optional()
  }),
  object: z.object({
    url: z.string(),
    title: z.string()
  })
});

export type JiraRemoteLink = z.infer<typeof JiraRemoteLinkSchema>;

/**
 * Jira webhook event payload
 */
export const JiraWebhookEventSchema = z.object({
  timestamp: z.number(),
  webhookEvent: z.string(),
  issue: JiraIssueSchema.optional(),
  changelog: z
    .object({
      id: z.string(),
      items: z.array(
        z.object({
          field: z.string(),
          fieldtype: z.string(),
          fieldId: z.string().optional(),
          from: z.string().nullable(),
          fromString: z.string().nullable(),
          to: z.string().nullable(),
          toString: z.string().nullable()
        })
      )
    })
    .optional(),
  user: JiraUserSchema.optional()
});

export type JiraWebhookEvent = z.infer<typeof JiraWebhookEventSchema>;

/**
 * Input for creating a Jira issue
 */
export interface CreateJiraIssueInput {
  projectKey: string;
  issueTypeId: string;
  summary: string;
  description?: any; // ADF format
  assigneeId?: string;
  priority?: string;
}

/**
 * Input for updating a Jira issue
 */
export interface UpdateJiraIssueInput {
  summary?: string;
  description?: any; // ADF format
  assigneeId?: string | null;
  priority?: string;
}
