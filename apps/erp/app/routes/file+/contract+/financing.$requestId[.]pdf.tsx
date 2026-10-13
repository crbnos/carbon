// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import type {
  ContractFinancingEventRow,
  ContractFinancingRow
} from "@carbon/documents/pdf";
import { ContractFinancingRequestPDF, ensureFont } from "@carbon/documents/pdf";
import type { FinancingOverride } from "@carbon/ee/contract-financing";
import {
  SF1443_LINE_LABELS,
  SF1443_WHOLE_DOLLAR_SCALE,
  type Sf1443Line
} from "@carbon/ee/contract-financing";
import { getFinancingRequest } from "@carbon/ee/contract-financing.server";
import { getLogger } from "@carbon/logger";
import {
  formatMoney,
  formatPercent,
  getPreferenceHeaders
} from "@carbon/utils";
import { renderToStream } from "@react-pdf/renderer";
import type { LoaderFunctionArgs } from "react-router";
import { getCompany } from "~/modules/settings";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "contract-financing", "pdf");

const SECTION_2: Sf1443Line[] = [
  "11",
  "12a",
  "12b",
  "12c",
  "13",
  "14a",
  "14b",
  "14c",
  "14d",
  "14e",
  "15",
  "16",
  "17",
  "18",
  "19"
];
const SECTION_3: Sf1443Line[] = [
  "20a",
  "20b",
  "20c",
  "20d",
  "20e",
  "21a",
  "21b",
  "21c",
  "21d",
  "21e",
  "22",
  "23",
  "24",
  "25",
  "26"
];

/**
 * A contract financing request as a PDF: the SF 1443 of a progress payment
 * request, or the events and values of a performance-based payment request.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });
  const { requestId } = params;
  if (!requestId) throw new Error("Could not find the request");

  const row = await client
    .from("contractFinancingRequest")
    .select(
      "customerContractId, contract:customerContract!contractFinancingRequest_contract_fkey(customerContractId, name, currencyCode, customer:customer!customerContract_customerId_fkey(name))"
    )
    .eq("id", requestId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (row.error || !row.data) {
    logger.error("Failed to load the financing request", {
      companyId,
      requestId,
      error: row.error
    });
    throw new Response("The request could not be found", { status: 404 });
  }

  const db = getDatabaseClient();
  const [company, detail, terms] = await Promise.all([
    getCompany(client, companyId),
    getFinancingRequest(db, {
      companyId,
      customerContractId: row.data.customerContractId,
      requestId
    }),
    client
      .from("customerContractFinancing")
      .select("contractPrice, initialAwardDate, isSmallBusiness")
      .eq("customerContractId", row.data.customerContractId)
      .eq("companyId", companyId)
      .maybeSingle()
  ]);
  if (company.error || !company.data || !detail) {
    logger.error("Failed to load the financing request PDF", {
      companyId,
      requestId,
      error: company.error
    });
    throw new Response("The request could not be found", { status: 404 });
  }

  const { locale } = getPreferenceHeaders(request);
  const contract = row.data.contract as unknown as {
    customerContractId: string;
    name: string | null;
    currencyCode: string | null;
    customer: { name: string } | null;
  } | null;
  const currency =
    contract?.currencyCode ?? company.data.baseCurrencyCode ?? "USD";
  const dollars = (value: unknown) =>
    typeof value === "number"
      ? formatMoney(value, locale, currency, SF1443_WHOLE_DOLLAR_SCALE)
      : "";
  const lines = (detail.lines ?? {}) as Record<string, unknown>;
  const overrides = (detail.overrides ?? {}) as Record<
    string,
    FinancingOverride
  >;
  const isPbp = detail.financingMethod === "Performance-Based Payments";
  const number = detail.requestNumber ? String(detail.requestNumber) : "Draft";
  const contractLabel = contract?.customerContractId ?? "";

  const identification = [
    { label: "Contractor", value: company.data.name },
    { label: "Customer", value: contract?.customer?.name ?? "" },
    { label: "Contract", value: `${contractLabel} ${contract?.name ?? ""}` },
    { label: "Request number", value: number },
    { label: "Request date", value: detail.requestDate },
    { label: "Costs through", value: detail.costsThroughDate },
    ...(isPbp
      ? []
      : [
          {
            label: "Small business",
            value: terms.data?.isSmallBusiness ? "Yes" : "No"
          },
          {
            label: "5. Contract price",
            value: dollars(Number(terms.data?.contractPrice ?? lines["5"]))
          },
          {
            label: "6A. Progress payment rate",
            value:
              typeof lines["6A"] === "number"
                ? formatPercent(lines["6A"], locale)
                : ""
          },
          {
            label: "6B. Liquidation rate",
            value:
              typeof lines["6B"] === "number"
                ? formatPercent(lines["6B"], locale)
                : ""
          },
          {
            label: "7. Initial award",
            value: terms.data?.initialAwardDate ?? ""
          }
        ])
  ];

  const effective = (line: string) => overrides[line]?.value ?? lines[line];
  const sf1443Row = (line: Sf1443Line): ContractFinancingRow => ({
    line,
    label: SF1443_LINE_LABELS[line],
    value: dollars(effective(line)),
    note: overrides[line]
      ? `Override of ${dollars(lines[line])}: ${overrides[line].reason}`
      : null
  });

  const sections = isPbp
    ? [
        {
          title: "Performance-based payment request",
          rows: [
            ["1a", "Value of events completed earlier"],
            ["1b", "Value of the events in this request"],
            ["1c", "Cumulative value"],
            ["2", "Total costs incurred to date"]
          ].map(([line, label]) => ({
            line: line!,
            label: label!,
            value: dollars(lines[line!])
          }))
        }
      ]
    : [
        {
          title: "Section II — Statement of costs",
          rows: SECTION_2.map(sf1443Row)
        },
        ...(lines.hasSection3 === true
          ? [
              {
                title: "Section III — Limits for outstanding progress payments",
                rows: SECTION_3.map(sf1443Row)
              }
            ]
          : [
              {
                title: "Amount of this request",
                rows: [sf1443Row("26")]
              }
            ]),
        {
          title: "For the contracting officer",
          rows: [
            {
              line: "27",
              label: "Amount approved",
              value:
                detail.approvedAmount === null
                  ? ""
                  : dollars(Number(detail.approvedAmount))
            }
          ]
        }
      ];

  const events: ContractFinancingEventRow[] = detail.events.map((event) => ({
    code: event.eventCode,
    description: event.description,
    clin: event.lineItemNumber ?? "",
    amount: dollars(event.amount)
  }));

  const title = isPbp
    ? `Performance-Based Payment Request ${number}`
    : `Progress Payment Request ${number} (SF 1443)`;

  await ensureFont();
  const stream = await renderToStream(
    <ContractFinancingRequestPDF
      company={company.data as any}
      title={title}
      identification={identification}
      sections={sections}
      events={isPbp ? events : undefined}
      documentId={`${contractLabel}-${number}`}
    />
  );

  const body: Buffer = await new Promise((resolve, reject) => {
    const buffers: Uint8Array[] = [];
    stream.on("data", (data) => buffers.push(data));
    stream.on("end", () => resolve(Buffer.concat(buffers)));
    stream.on("error", reject);
  });

  return new Response(new Uint8Array(body), {
    status: 200,
    headers: new Headers({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${contractLabel} request ${number}.pdf"`
    })
  });
}
