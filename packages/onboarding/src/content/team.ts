import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

export interface TeamRole {
  role: MessageDescriptor;
  owns: MessageDescriptor;
}

// Generic Carbon-side roles. Names are filled per-customer via Setup & Controls
// contacts; this is the template shape.
export const TEAM_ROLES: TeamRole[] = [
  {
    role: msg`Implementation Lead`,
    owns: msg`Your project end to end: the plan, the gates, and go-live`
  },
  {
    role: msg`Solutions Engineer`,
    owns: msg`Configuration, data migration, and any integrations`
  },
  {
    role: msg`Support`,
    owns: msg`Day-to-day questions and hypercare after launch`
  }
];
