import type { getCompanies } from "./services/users";

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  userId: string;
  companyId: string;
  email: string;
  expiresIn: number;
  expiresAt: number;
}

export type Company = NonNullable<
  Awaited<ReturnType<typeof getCompanies>>["data"]
>[number];

export type CompanyPermission = {
  view: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
};

export type Permission = {
  view: string[];
  create: string[];
  update: string[];
  delete: string[];
};

export type Result = {
  success: boolean;
  message?: string;
  flash?: "success" | "error";
};
