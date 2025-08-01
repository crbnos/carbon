import { SUPABASE_URL } from "@carbon/auth";
import { generatePath } from "@remix-run/react";

const challenge = "/challenge"; // from ~/routes/challenge+ folder
const course = "/course"; // from ~/routes/course+ folder
const lesson = "/lesson"; // from ~/routes/lesson+ folder

const ERP_URL = SUPABASE_URL.includes("localhost")
  ? "http://localhost:3000"
  : "https://app.carbon.ms";

export const path = {
  to: {
    about: "/about",
    accountSettings: `${ERP_URL}/x/account`,
    callback: "/callback",
    challenge: (topicId: string) => generatePath(`${challenge}/${topicId}`),
    course: (moduleId: string, courseId: string) =>
      generatePath(`${course}/${moduleId}/${courseId}`),
    dashboard: `${ERP_URL}/x`,
    healthcheck: "/healthcheck",
    login: "/login",
    logout: "/logout",
    refreshSession: "/refresh-session",
    root: "/",
    lesson: (id: string) => generatePath(`${lesson}/${id}`),
  },
} as const;

export const removeSubdomain = (url?: string): string => {
  if (!url) return "localhost:3000";
  const parts = url.split("/")[0].split(".");

  const domain = parts.slice(-2).join(".");

  return domain;
};

export const getStoragePath = (bucket: string, path: string) => {
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
};

export const requestReferrer = (request: Request) => {
  return request.headers.get("referer");
};

export const getParams = (request: Request) => {
  const url = new URL(requestReferrer(request) ?? "");
  const searchParams = new URLSearchParams(url.search);
  return searchParams.toString();
};
