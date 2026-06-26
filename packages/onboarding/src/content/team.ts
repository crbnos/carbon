export interface TeamRole {
  role: string;
  owns: string;
}

// Generic Carbon-side roles. Names are filled per-customer via Setup & Controls
// contacts; this is the template shape.
export const TEAM_ROLES: TeamRole[] = [
  {
    role: "Implementation Lead",
    owns: "Your project end to end: the plan, the gates, and go-live"
  },
  {
    role: "Solutions Engineer",
    owns: "Configuration, data migration, and any integrations"
  },
  {
    role: "Support",
    owns: "Day-to-day questions and hypercare after launch"
  }
];
