export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  userId: string;
  companyId: string;
  email: string;
  expiresIn: number;
  expiresAt: number;
}
