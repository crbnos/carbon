export type AutodeskToken = {
  token: string;
  expiresAt: number;
};

export type AutodeskTokenResponse = {
  access_token?: string;
  expires_in: number;
};
