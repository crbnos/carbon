export async function sendToProxyBox({
  url,
  apiKey,
  content
}: {
  url: string;
  apiKey?: string | null;
  content: string | Buffer;
}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/octet-stream"
  };

  if (apiKey) {
    headers["X-API-Key"] = apiKey;
  }

  const body = typeof content === "string" ? content : new Uint8Array(content);

  const response = await fetch(url, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(30_000)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `ProxyBox delivery failed: ${response.status} ${response.statusText}${text ? ` — ${text}` : ""}`
    );
  }

  return { success: true };
}
