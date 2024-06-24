const admin = {
  email: "admin@carbonos.dev",
  password: "carbon",
  firstName: "Carbon",
  lastName: "Admin",
};

const ALL_TEAMS_ID = "0";

const claims: Record<string, string> = {
  role: "employee",
};

const permissions: Record<string, string[]> = {
  settings_update: [ALL_TEAMS_ID],
  users_update: [ALL_TEAMS_ID],
};

export { admin, claims, permissions };
