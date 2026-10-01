// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Copyright (C) Carbon Manufacturing Systems Corporation.
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { z } from "zod";
import { LinearWorkStateType } from "./utils";

export const LinearIssueSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullish(),
  url: z.string(),
  state: z.object({
    name: z.string(),
    color: z.string(),
    type: z.nativeEnum(LinearWorkStateType)
  }),
  identifier: z.string(),
  dueDate: z.string().nullish(),
  assignee: z
    .object({
      email: z.string()
    })
    .nullish()
});

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
