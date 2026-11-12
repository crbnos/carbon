// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export class SubmissionTooLargeError extends Error {}

/** Cap actual bytes before the multipart parser can buffer an unbounded body. */
export async function limitedFormData(request: Request, maxBytes: number) {
  if (!request.body) return request.formData();

  const reader = request.body.getReader();
  let size = 0;
  let exceeded = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) return controller.close();
      size += value.byteLength;
      if (size > maxBytes) {
        exceeded = true;
        controller.error(new SubmissionTooLargeError());
        void reader.cancel().catch(() => undefined);
        return;
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    }
  });
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  const bounded = new Request(request.url, {
    method: request.method,
    headers,
    body,
    duplex: "half"
  } as RequestInit);
  try {
    return await bounded.formData();
  } catch (error) {
    if (exceeded) throw new SubmissionTooLargeError();
    throw error;
  }
}
