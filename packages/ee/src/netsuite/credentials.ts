export function foldNetSuiteCredentials(
  metadata: Record<string, unknown>
): Record<string, unknown> {
  const {
    accountId,
    consumerKey,
    consumerSecret,
    tokenId,
    tokenSecret,
    subsidiaryId,
    ...rest
  } = metadata;

  if (typeof accountId !== "string" || accountId.trim().length === 0) {
    return metadata;
  }

  const subsidiary =
    typeof subsidiaryId === "string" ? subsidiaryId.trim() : "";

  return {
    ...rest,
    credentials: {
      type: "tba",
      accountId: accountId.trim(),
      consumerKey: typeof consumerKey === "string" ? consumerKey : "",
      consumerSecret: typeof consumerSecret === "string" ? consumerSecret : "",
      tokenId: typeof tokenId === "string" ? tokenId : "",
      tokenSecret: typeof tokenSecret === "string" ? tokenSecret : "",
      ...(subsidiary ? { providerMetadata: { subsidiaryId: subsidiary } } : {})
    }
  };
}

export function unfoldNetSuiteCredentials(
  metadata: Record<string, unknown>
): Record<string, unknown> {
  const credentials = metadata.credentials as
    | Record<string, unknown>
    | undefined;
  if (!credentials || credentials.type !== "tba") return metadata;

  const providerMetadata =
    (credentials.providerMetadata as Record<string, unknown> | undefined) ?? {};

  return {
    ...metadata,
    accountId:
      typeof credentials.accountId === "string" ? credentials.accountId : "",
    consumerKey:
      typeof credentials.consumerKey === "string"
        ? credentials.consumerKey
        : "",
    consumerSecret:
      typeof credentials.consumerSecret === "string"
        ? credentials.consumerSecret
        : "",
    tokenId: typeof credentials.tokenId === "string" ? credentials.tokenId : "",
    tokenSecret:
      typeof credentials.tokenSecret === "string"
        ? credentials.tokenSecret
        : "",
    subsidiaryId:
      typeof providerMetadata.subsidiaryId === "string"
        ? providerMetadata.subsidiaryId
        : ""
  };
}
