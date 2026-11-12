// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { CarbonError } from "@carbon/api/service-fn.server";
import { validator } from "@carbon/form";
import { Ratelimit, redis } from "@carbon/kv";
import { getClientIp } from "@carbon/utils";
import { data } from "react-router";
import {
  customerPortalPoValidator,
  customerPortalRfqValidator
} from "~/modules/sales/sales.models";
import {
  submitCustomerPortalPo,
  submitCustomerPortalRfq
} from "~/modules/sales/sales.server";
import { customerPortalSubmissionContext } from "~/modules/sales/sales.service";

const limiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "1 m"),
  prefix: "@carbon/customer-portal-submission"
});

class SubmissionTooLargeError extends Error {}

/** Cap actual bytes before the multipart parser can buffer an unbounded body. */
async function limitedFormData(request: Request, maxBytes: number) {
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

function failure(status: number, code: string, message: string) {
  return data(
    { success: false, code, message },
    { status, headers: status === 429 ? { "Retry-After": "60" } : undefined }
  );
}

function serviceFailure(error: CarbonError, fallback: string) {
  return failure(
    error.status,
    error.category,
    error.category === "internal" ? fallback : error.message
  );
}

/** The public HTTP boundary shared by the RFQ and PO routes. */
export async function handleCustomerPortalSubmission(
  request: Request,
  portalId: string | undefined,
  submissionType: "rfq" | "po"
) {
  if (request.method !== "POST")
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  if (!portalId) return new Response(null, { status: 404 });

  const limit = await limiter.limit(getClientIp(request) ?? "127.0.0.1");
  if (!limit.success)
    return failure(
      429,
      "rate_limited",
      "Please wait before sending another request"
    );

  const maxBytes = (submissionType === "rfq" ? 55 : 11) * 1024 * 1024;
  const length = request.headers.get("content-length");
  if (length !== null && Number(length) > maxBytes)
    return failure(413, "payload_too_large", "Attachments are too large");

  const scope = await customerPortalSubmissionContext(portalId);
  if (!scope) return new Response(null, { status: 404 });

  let form: FormData;
  let lines: unknown;
  try {
    form = await limitedFormData(request, maxBytes);
    lines = JSON.parse(String(form.get("lines") ?? "[]"));
  } catch (error) {
    if (error instanceof SubmissionTooLargeError)
      return failure(413, "payload_too_large", "Attachments are too large");
    return failure(400, "invalid_request", "Invalid form data or line items");
  }

  if (submissionType === "rfq") {
    const input = await validator(customerPortalRfqValidator).validate({
      idempotencyKey: form.get("idempotencyKey"),
      customerReference: form.get("customerReference") || undefined,
      quoteNeededBy: form.get("quoteNeededBy") || undefined,
      notes: form.get("notes") || undefined,
      lines,
      files: form
        .getAll("files")
        .filter((file) => file instanceof File && file.size > 0)
    });
    if (input.error || !input.data)
      return failure(
        400,
        "invalid_request",
        "Please check the RFQ details and attachments"
      );
    const result = await submitCustomerPortalRfq(scope.ctx, {
      ...input.data,
      portalId,
      customerId: scope.customerId
    });
    if (result.error)
      return serviceFailure(
        result.error,
        "Unable to save the request. Please try again."
      );
    return data(
      {
        success: true,
        submissionId: result.data.submissionId,
        salesRfqId: result.data.salesRfqId,
        message: "Request for quote received"
      },
      { status: 201 }
    );
  }

  const input = await validator(customerPortalPoValidator).validate({
    idempotencyKey: form.get("idempotencyKey"),
    poNumber: form.get("poNumber"),
    quoteId: form.get("quoteId") || undefined,
    requestedDelivery: form.get("requestedDelivery") || undefined,
    lines,
    file: form.get("file")
  });
  if (input.error || !input.data)
    return failure(
      400,
      "invalid_request",
      "Please check the purchase order details and PDF"
    );
  const result = await submitCustomerPortalPo(scope.ctx, {
    ...input.data,
    portalId,
    customerId: scope.customerId
  });
  if (result.error)
    return serviceFailure(
      result.error,
      "Unable to save the purchase order. Please try again."
    );
  return data(
    {
      success: true,
      submissionId: result.data.submissionId,
      message: "Purchase order received for review"
    },
    { status: 201 }
  );
}
