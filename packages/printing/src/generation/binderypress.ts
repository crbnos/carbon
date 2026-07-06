type RenderFormat = "zpl" | "pdf";

type RenderRequest = {
  apiKey: string;
  templateId: string;
  data: Record<string, unknown>;
  format: RenderFormat;
};

type RenderResponse = {
  content: string;
  contentType: "zpl" | "pdf";
};

export async function renderWithBinderyPress({
  apiKey,
  templateId,
  data,
  format
}: RenderRequest): Promise<RenderResponse> {
  const response = await fetch("https://api.binderypress.dev/v1/render", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      templateId,
      data,
      format,
      delivery: "inline"
    }),
    signal: AbortSignal.timeout(30_000)
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `BinderyPress render failed: ${response.status} ${response.statusText}${body ? ` — ${body}` : ""}`
    );
  }

  if (format === "zpl") {
    const text = await response.text();
    return { content: text, contentType: "zpl" };
  }

  // PDF/PNG come back as binary
  const buffer = Buffer.from(await response.arrayBuffer());
  return { content: buffer.toString("base64"), contentType: "pdf" };
}
