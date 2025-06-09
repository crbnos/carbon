import dotenv from "dotenv";
dotenv.config();

const admin = {
  email: process.env.DEFAULT_EMAIL_ADDRESS ?? "admin@carbon.us.org",
  password: Math.random().toString(36).substring(2, 15),
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
