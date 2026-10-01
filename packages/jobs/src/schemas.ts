// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { z } from "zod";

/**
 * Webhook payload schemas.
 * Extracted into a separate file so they can be imported by app code
 * without pulling in server-only dependencies.
 */

export const syncIssueFromJiraSchema = z.object({
  companyId: z.string(),
  event: z.object({
    timestamp: z.number().optional(),
    webhookEvent: z.string(),
    issue: z
      .object({
        id: z.string(),
        key: z.string(),
        fields: z.object({
          summary: z.string().optional(),
          description: z.any().nullable().optional(),
          status: z
            .object({
              name: z.string().optional(),
              statusCategory: z
                .object({
                  key: z.string()
                })
                .optional()
            })
            .optional(),
          assignee: z
            .object({
              accountId: z.string().optional(),
              emailAddress: z.string().optional(),
              displayName: z.string().optional()
            })
            .nullable()
            .optional(),
          duedate: z.string().nullable().optional()
        })
      })
      .optional(),
    changelog: z
      .object({
        items: z.array(
          z.object({
            field: z.string(),
            fieldtype: z.string().optional(),
            from: z.string().nullable().optional(),
            fromString: z.string().nullable().optional(),
            to: z.string().nullable().optional(),
            toString: z.string().nullable().optional()
          })
        )
      })
      .optional()
  })
});

export const syncIssueFromLinearSchema = z.object({
  companyId: z.string(),
  event: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("Issue"),
      action: z.literal("update"),
      data: z.object({
        id: z.string(),
        assigneeId: z.string().optional()
      })
    })
  ])
});
