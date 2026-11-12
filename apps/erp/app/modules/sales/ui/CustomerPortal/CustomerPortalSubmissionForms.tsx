// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button, Input, Textarea } from "@carbon/react";
import type { FormEvent } from "react";
import { useState } from "react";
import { useFetcher } from "react-router";

type SubmissionResult = {
  success: boolean;
  submissionId?: string;
  salesRfqId?: string;
  message: string;
};

type QuoteOption = {
  id: string;
  quoteId: string;
  status: string | null;
};

type RfqLine = {
  partNumber: string;
  description: string;
  quantity: number;
  delivery: string;
};

type PoLine = {
  partNumber: string;
  description: string;
  quantity: number;
  unitPrice: string;
};

const newRfqLine = (): RfqLine => ({
  partNumber: "",
  description: "",
  quantity: 1,
  delivery: ""
});

const newPoLine = (): PoLine => ({
  partNumber: "",
  description: "",
  quantity: 1,
  unitPrice: ""
});

function ensureSubmissionKey(event: FormEvent<HTMLFormElement>) {
  const field = event.currentTarget.elements.namedItem("idempotencyKey");
  if (field instanceof HTMLInputElement && !field.value) {
    field.value = crypto.randomUUID();
  }
}

function Field({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-sm font-medium">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Result({ result }: { result: SubmissionResult | undefined }) {
  if (!result) return null;
  return (
    <p
      role="status"
      className={
        result.success
          ? "rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300"
          : "rounded-md bg-destructive/10 p-3 text-sm text-destructive"
      }
    >
      {result.message}
    </p>
  );
}

export function CustomerPortalSubmissionForms({
  portalId,
  quotes,
  initialForm,
  initialQuoteId,
  onClose
}: {
  portalId: string;
  quotes: QuoteOption[];
  initialForm: "rfq" | "po";
  initialQuoteId?: string;
  onClose: () => void;
}) {
  const [form, setForm] = useState(initialForm);
  const rfqFetcher = useFetcher<SubmissionResult>();
  const poFetcher = useFetcher<SubmissionResult>();
  const [rfqLines, setRfqLines] = useState<RfqLine[]>([newRfqLine()]);
  const [poLines, setPoLines] = useState<PoLine[]>([newPoLine()]);
  const [selectedQuoteId, setSelectedQuoteId] = useState(initialQuoteId ?? "");

  function updateRfqLine(index: number, patch: Partial<RfqLine>) {
    setRfqLines((lines) =>
      lines.map((line, position) =>
        position === index ? { ...line, ...patch } : line
      )
    );
  }

  function updatePoLine(index: number, patch: Partial<PoLine>) {
    setPoLines((lines) =>
      lines.map((line, position) =>
        position === index ? { ...line, ...patch } : line
      )
    );
  }

  return (
    <section
      className="rounded-lg border bg-card p-4 shadow-sm sm:p-6"
      aria-label="Send a request"
    >
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            {form === "rfq" ? "Request a quote" : "Send a purchase order"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {form === "rfq"
              ? "Send the parts and files needed to prepare a quote."
              : "Your PO will be reviewed before the order is confirmed."}
          </p>
        </div>
        <Button type="button" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="mb-5 flex gap-2" role="tablist" aria-label="Request type">
        <Button
          type="button"
          variant={form === "rfq" ? "active" : "secondary"}
          role="tab"
          aria-selected={form === "rfq"}
          onClick={() => setForm("rfq")}
        >
          Request a quote
        </Button>
        <Button
          type="button"
          variant={form === "po" ? "active" : "secondary"}
          role="tab"
          aria-selected={form === "po"}
          onClick={() => setForm("po")}
        >
          Send a PO
        </Button>
      </div>
      {form === "rfq" ? (
        <rfqFetcher.Form
          method="post"
          action={`/share/customer/${portalId}/rfq`}
          encType="multipart/form-data"
          onSubmit={ensureSubmissionKey}
          className="space-y-5"
        >
          <input type="hidden" name="idempotencyKey" defaultValue="" />
          <input
            type="hidden"
            name="lines"
            value={JSON.stringify(
              rfqLines.map((line) => ({
                ...line,
                partNumber: line.partNumber.trim(),
                description: line.description.trim() || undefined,
                delivery: line.delivery.trim() || undefined
              }))
            )}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Your reference">
              <Input
                name="customerReference"
                maxLength={100}
                placeholder="Your RFQ number"
              />
            </Field>
            <Field label="Quote needed by">
              <Input name="quoteNeededBy" type="date" />
            </Field>
          </div>
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Parts and quantities</h3>
            {rfqLines.map((line, index) => (
              <div
                key={index}
                className="grid gap-2 rounded-md border p-3 sm:grid-cols-[2fr_1fr_1fr_auto]"
              >
                <Field label="Part number">
                  <Input
                    required
                    value={line.partNumber}
                    onChange={(event) =>
                      updateRfqLine(index, { partNumber: event.target.value })
                    }
                    maxLength={120}
                  />
                </Field>
                <Field label="Quantity">
                  <Input
                    required
                    type="number"
                    min="0.00001"
                    step="any"
                    value={line.quantity}
                    onChange={(event) =>
                      updateRfqLine(index, {
                        quantity: Number(event.target.value)
                      })
                    }
                  />
                </Field>
                <Field label="Delivery">
                  <Input
                    value={line.delivery}
                    onChange={(event) =>
                      updateRfqLine(index, { delivery: event.target.value })
                    }
                    placeholder="Requested timing"
                  />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  className="self-end"
                  aria-label={`Remove part ${index + 1}`}
                  isDisabled={rfqLines.length === 1}
                  onClick={() =>
                    setRfqLines((lines) =>
                      lines.filter((_, position) => position !== index)
                    )
                  }
                >
                  Remove
                </Button>
                <Field label="Description">
                  <Input
                    value={line.description}
                    onChange={(event) =>
                      updateRfqLine(index, { description: event.target.value })
                    }
                    placeholder="Optional details"
                  />
                </Field>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              isDisabled={rfqLines.length >= 50}
              onClick={() => setRfqLines((lines) => [...lines, newRfqLine()])}
            >
              Add part
            </Button>
          </div>
          <Field label="Notes">
            <Textarea
              name="notes"
              maxLength={5000}
              placeholder="Delivery schedule, packaging, or certifications needed"
            />
          </Field>
          <Field label="Attachments">
            <Input
              name="files"
              type="file"
              multiple
              accept=".pdf,.docx,.xlsx,.png,.jpg,.jpeg"
            />
            <span className="text-xs font-normal text-muted-foreground">
              Up to 5 files, 10 MB each. PDF, DOCX, XLSX, PNG, or JPG.
            </span>
          </Field>
          <Result result={rfqFetcher.data} />
          <Button
            type="submit"
            variant="primary"
            isDisabled={rfqFetcher.state !== "idle" || rfqFetcher.data?.success}
          >
            {rfqFetcher.state === "idle" ? "Send request" : "Sending…"}
          </Button>
        </rfqFetcher.Form>
      ) : (
        <poFetcher.Form
          method="post"
          action={`/share/customer/${portalId}/po`}
          encType="multipart/form-data"
          onSubmit={ensureSubmissionKey}
          className="space-y-5"
        >
          <input type="hidden" name="idempotencyKey" defaultValue="" />
          <input
            type="hidden"
            name="lines"
            value={JSON.stringify(
              selectedQuoteId
                ? []
                : poLines.map((line) => ({
                    partNumber: line.partNumber.trim(),
                    description: line.description.trim() || undefined,
                    quantity: line.quantity,
                    unitPrice: line.unitPrice.trim()
                      ? Number(line.unitPrice)
                      : undefined
                  }))
            )}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Your PO number">
              <Input
                name="poNumber"
                required
                maxLength={100}
                placeholder="Your purchase order number"
              />
            </Field>
            <Field label="Against quote">
              <select
                name="quoteId"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={selectedQuoteId}
                onChange={(event) => setSelectedQuoteId(event.target.value)}
              >
                <option value="">No quote</option>
                {quotes
                  .filter((quote) => quote.status === "Sent")
                  .map((quote) => (
                    <option key={quote.id} value={quote.id}>
                      {quote.quoteId}
                    </option>
                  ))}
              </select>
            </Field>
          </div>
          {selectedQuoteId ? (
            <p className="rounded-md border bg-muted/50 p-3 text-sm">
              The selected quote supplies the lines and prices. Add your PO
              number and signed PDF below.
            </p>
          ) : (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">PO lines</h3>
              {poLines.map((line, index) => (
                <div
                  key={index}
                  className="grid gap-2 rounded-md border p-3 sm:grid-cols-[2fr_1fr_1fr_auto]"
                >
                  <Field label="Part number">
                    <Input
                      required
                      value={line.partNumber}
                      onChange={(event) =>
                        updatePoLine(index, { partNumber: event.target.value })
                      }
                      maxLength={120}
                    />
                  </Field>
                  <Field label="Quantity">
                    <Input
                      required
                      type="number"
                      min="0.00001"
                      step="any"
                      value={line.quantity}
                      onChange={(event) =>
                        updatePoLine(index, {
                          quantity: Number(event.target.value)
                        })
                      }
                    />
                  </Field>
                  <Field label="Unit price">
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      value={line.unitPrice}
                      onChange={(event) =>
                        updatePoLine(index, { unitPrice: event.target.value })
                      }
                      placeholder="Optional"
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    className="self-end"
                    aria-label={`Remove line ${index + 1}`}
                    isDisabled={poLines.length === 1}
                    onClick={() =>
                      setPoLines((lines) =>
                        lines.filter((_, position) => position !== index)
                      )
                    }
                  >
                    Remove
                  </Button>
                  <Field label="Description">
                    <Input
                      value={line.description}
                      onChange={(event) =>
                        updatePoLine(index, { description: event.target.value })
                      }
                      placeholder="Optional details"
                    />
                  </Field>
                </div>
              ))}
              <Button
                type="button"
                variant="secondary"
                isDisabled={poLines.length >= 50}
                onClick={() => setPoLines((lines) => [...lines, newPoLine()])}
              >
                Add line
              </Button>
            </div>
          )}
          <Field label="Requested delivery">
            <Input name="requestedDelivery" type="date" />
          </Field>
          <Field label="Signed PO PDF">
            <Input
              name="file"
              type="file"
              accept=".pdf,application/pdf"
              required
            />
            <span className="text-xs font-normal text-muted-foreground">
              PDF, up to 10 MB.
            </span>
          </Field>
          <p className="rounded-md bg-muted p-3 text-sm">
            Your PO will appear under Orders as Awaiting confirmation while it
            is reviewed.
          </p>
          <Result result={poFetcher.data} />
          <Button
            type="submit"
            variant="primary"
            isDisabled={poFetcher.state !== "idle" || poFetcher.data?.success}
          >
            {poFetcher.state === "idle" ? "Send PO" : "Sending…"}
          </Button>
        </poFetcher.Form>
      )}
    </section>
  );
}
