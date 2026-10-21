// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { equals } from "@carbon/utils";
import { Plural, Trans } from "@lingui/react/macro";
import { LuCircleCheck, LuTriangleAlert } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useParams } from "react-router";
import { SetupBody, SetupSection } from "~/components/Setup";
import { useRouteData } from "~/hooks";
import { getDefaultAccounts } from "~/modules/accounting";
import { getLaborCategories } from "~/modules/projects";
import type {
  ProjectContractAccountDefault,
  ProjectContractGap
} from "~/modules/sales";
import {
  laborCategoriesWithoutBillRate,
  projectContractAccountDefaults
} from "~/modules/sales";
import type {
  ContractRouteData,
  ProjectContractReviewData
} from "~/modules/sales/ui/Contracts";
import {
  ContractMoney,
  ContractSummary,
  contractLineName,
  useProjectContractGaps
} from "~/modules/sales/ui/Contracts";
import { path } from "~/utils/path";

const logger = getLogger("erp", "contract-setup-review");

/** A project contract's Review step also lists what its setup still lacks
 *  (spec section 5). The reads are best effort: a fact the user may not read
 *  (RLS) or that fails to load is unknown, and gives no gap. */
export async function loader({
  request,
  params
}: LoaderFunctionArgs): Promise<ProjectContractReviewData> {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });
  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [contract, lines] = await Promise.all([
    client
      .from("customerContract")
      .select("billingBasis, projectId")
      .eq("id", id)
      .eq("companyId", companyId)
      .maybeSingle(),
    client
      .from("customerContractLine")
      .select("id, billingMethod, projectId, projectElementId")
      .eq("customerContractId", id)
      .eq("companyId", companyId)
  ]);
  if (contract.data?.billingBasis !== "Project") return { facts: null };
  if (lines.error) {
    logger.error("Failed to load the contract lines for review", {
      companyId,
      id,
      error: lines.error
    });
  }

  const contractLines = lines.data ?? [];
  const projectIds = [
    ...new Set(
      [
        contract.data.projectId,
        ...contractLines.map((line) => line.projectId)
      ].filter((projectId): projectId is string => !!projectId)
    )
  ];
  const elementIds = [
    ...new Set(
      contractLines.flatMap((line) =>
        line.projectElementId ? [line.projectElementId] : []
      )
    )
  ];
  const timeAndMaterialsLineIds = contractLines
    .filter((line) => line.billingMethod === "Time & Materials")
    .map((line) => line.id);

  const [company, projects, elements, categories, lineRates, accountDefaults] =
    await Promise.all([
      client
        .from("company")
        .select("baseCurrencyCode")
        .eq("id", companyId)
        .maybeSingle(),
      projectIds.length > 0
        ? client
            .from("project")
            .select("id, costTreatment")
            .in("id", projectIds)
            .eq("companyId", companyId)
        : Promise.resolve({ data: [], error: null }),
      elementIds.length > 0
        ? client
            .from("projectElement")
            .select("id, isBilling")
            .in("id", elementIds)
            .eq("companyId", companyId)
        : Promise.resolve({ data: [], error: null }),
      timeAndMaterialsLineIds.length > 0
        ? getLaborCategories(client, companyId, {
            search: null,
            limit: 1000,
            offset: 0
          })
        : Promise.resolve({ data: [], error: null }),
      timeAndMaterialsLineIds.length > 0
        ? client
            .from("customerContractLaborRate")
            .select("customerContractLineId, laborCategoryId")
            .in("customerContractLineId", timeAndMaterialsLineIds)
            .eq("companyId", companyId)
        : Promise.resolve({ data: [], error: null }),
      getDefaultAccounts(client, companyId)
    ]);

  for (const [what, result] of [
    ["company", company],
    ["projects", projects],
    ["elements", elements],
    ["labor categories", categories],
    ["contract labor rates", lineRates]
  ] as const) {
    if (result.error) {
      logger.error(`Failed to load the ${what} for the contract review`, {
        companyId,
        id,
        error: result.error
      });
    }
  }

  // Without `accounting_view` the read finds no row: unknown, not empty.
  const defaults = accountDefaults.error ? null : accountDefaults.data;
  const emptyAccountDefaults = defaults
    ? projectContractAccountDefaults.filter((account) => !defaults[account])
    : null;

  return {
    facts: {
      baseCurrencyCode: company.data?.baseCurrencyCode ?? null,
      costTreatmentByProject: Object.fromEntries(
        (projects.data ?? []).map((p) => [p.id, p.costTreatment])
      ),
      billingElementById: Object.fromEntries(
        (elements.data ?? []).map((e) => [e.id, e.isBilling])
      ),
      // A failed rate read must not turn covered categories into a gap.
      laborCategoriesWithoutBillRate: lineRates.error
        ? []
        : laborCategoriesWithoutBillRate({
            categories: categories.data ?? [],
            timeAndMaterialsLineIds,
            lineRates: lineRates.data ?? []
          }),
      emptyAccountDefaults
    }
  };
}

/** Setup step 5: the contract at a glance, and anything that would stop
 *  Confirm. Confirm and Save as Draft are in the footer. */
export default function ContractSetupReviewRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<ContractRouteData>(path.to.contract(id));
  const projectGaps = useProjectContractGaps(id);
  if (!routeData) return null;
  const {
    contract,
    lines,
    schedule,
    computedSchedule,
    residuals,
    revenueResiduals
  } = routeData;

  const { currencyCode } = contract;
  const isProject = contract.billingBasis === "Project";
  const nameOf = (lineId: string) => {
    const line = lines.find((l) => l.id === lineId);
    return line ? contractLineName(line) : lineId;
  };
  const invoiceGaps = Object.entries(residuals).filter(
    ([, residual]) => !equals(residual, 0)
  );
  const revenueGaps = Object.entries(revenueResiduals).filter(
    ([, residual]) => !equals(residual, 0)
  );
  const isReady = isProject
    ? (projectGaps ?? []).length === 0
    : lines.length > 0 && invoiceGaps.length === 0 && revenueGaps.length === 0;

  return (
    <SetupBody>
      <SetupSection
        title={<Trans>Review</Trans>}
        description={
          isProject ? (
            <Trans>
              Confirming starts billing: project cost each billing period, and
              each billing event on its date. After that the lines change with
              Amend.
            </Trans>
          ) : (
            <Trans>
              Confirming fixes the invoice schedule and starts invoicing. After
              that the terms and lines change with Amend.
            </Trans>
          )
        }
      >
        <div className="w-full">
          <ContractSummary
            contract={contract}
            lines={lines}
            schedule={schedule}
            computedSchedule={computedSchedule}
          />
        </div>
      </SetupSection>

      <SetupSection title={<Trans>Before You Confirm</Trans>}>
        {isReady ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LuCircleCheck className="size-4 shrink-0" />
            {isProject ? (
              <Trans>The contract is ready to bill.</Trans>
            ) : (
              <Trans>
                Every line is fully invoiced and recognizes what it bills.
              </Trans>
            )}
          </p>
        ) : isProject ? (
          <ul className="flex w-full max-w-3xl flex-col gap-3 text-sm">
            {(projectGaps ?? []).map((gap) => (
              <ProjectGap
                key={gapKey(gap)}
                gap={gap}
                contractId={id}
                currencyCode={currencyCode}
                nameOf={nameOf}
              />
            ))}
          </ul>
        ) : (
          <ul className="flex w-full max-w-3xl flex-col gap-3 text-sm">
            {lines.length === 0 && (
              <Gap to={path.to.contractSetup(id, "products")}>
                <Trans>Add at least one service.</Trans>
              </Gap>
            )}
            {invoiceGaps.map(([lineId, residual]) => (
              <Gap
                key={`invoice-${lineId}`}
                to={path.to.contractSetup(id, "invoicing")}
              >
                <Trans>
                  {nameOf(lineId)} has{" "}
                  <ContractMoney value={residual} currencyCode={currencyCode} />{" "}
                  left to invoice.
                </Trans>
              </Gap>
            ))}
            {revenueGaps.map(([lineId, residual]) => (
              <Gap
                key={`revenue-${lineId}`}
                to={path.to.contractSetup(id, "revenue")}
              >
                <Trans>
                  {nameOf(lineId)} has{" "}
                  <ContractMoney value={residual} currencyCode={currencyCode} />{" "}
                  left to recognize.
                </Trans>
              </Gap>
            ))}
          </ul>
        )}
      </SetupSection>
    </SetupBody>
  );
}

function gapKey(gap: ProjectContractGap) {
  switch (gap.key) {
    case "noBillingElement":
    case "notBillingElement":
    case "billingEvents":
      return `${gap.key}-${gap.lineId}`;
    case "costTreatment":
      return `${gap.key}-${gap.projectId}`;
    case "accountDefault":
      return `${gap.key}-${gap.account}`;
    default:
      return gap.key;
  }
}

/** One gap of a project contract, linked to where it is fixed. */
function ProjectGap({
  gap,
  contractId,
  currencyCode,
  nameOf
}: {
  gap: ProjectContractGap;
  contractId: string;
  currencyCode: string;
  nameOf: (lineId: string) => string;
}) {
  switch (gap.key) {
    case "noLines":
      return (
        <Gap to={path.to.contractSetup(contractId, "products")}>
          <Trans>Add at least one line.</Trans>
        </Gap>
      );
    case "noBillingElement":
      return (
        <Gap to={path.to.contractLine(contractId, gap.lineId)}>
          <Trans>{nameOf(gap.lineId)} has no billing element.</Trans>
        </Gap>
      );
    case "notBillingElement":
      return (
        <Gap to={path.to.projectElement(gap.projectId, gap.elementId)}>
          <Trans>
            The billing element of {nameOf(gap.lineId)} is not marked as a
            billing element.
          </Trans>
        </Gap>
      );
    case "costTreatment":
      return (
        <Gap to={path.to.project(gap.projectId)}>
          <Trans>The project's cost treatment is not Contract.</Trans>
        </Gap>
      );
    case "currency":
      return (
        <Gap to={path.to.contractSetup(contractId, "details")}>
          <Trans>
            Project billing needs the contract in the base currency,{" "}
            {gap.baseCurrencyCode}.
          </Trans>
        </Gap>
      );
    case "billingEvents":
      return (
        <Gap to={path.to.contractSetup(contractId, "invoicing")}>
          <Trans>
            The billing events of {nameOf(gap.lineId)} have{" "}
            <ContractMoney value={gap.residual} currencyCode={currencyCode} />{" "}
            left to invoice.
          </Trans>
        </Gap>
      );
    case "laborBillRate":
      return (
        <Gap to={path.to.laborCategories} warning>
          <Plural
            value={gap.count}
            one="# labor category has no bill rate and no contract rate."
            other="# labor categories have no bill rate and no contract rate."
          />
        </Gap>
      );
    case "accountDefault":
      return (
        <Gap to={path.to.accountingDefaults} warning>
          <AccountDefaultGap account={gap.account} />
        </Gap>
      );
  }
}

function AccountDefaultGap({
  account
}: {
  account: ProjectContractAccountDefault;
}) {
  switch (account) {
    case "projectWorkInProgressAccount":
      return <Trans>The Project WIP default account is empty.</Trans>;
    case "deferredRevenueAccount":
      return <Trans>The Deferred Revenue default account is empty.</Trans>;
    case "contractAssetAccount":
      return <Trans>The Contract Assets default account is empty.</Trans>;
    case "contractLossProvisionAccount":
      return (
        <Trans>The Contract Loss Provision default account is empty.</Trans>
      );
  }
}

/** One thing stopping Confirm, linked to the step that fixes it. A warning
 *  does not stop Confirm. */
function Gap({
  to,
  warning = false,
  children
}: {
  to: string;
  warning?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-2">
      <LuTriangleAlert
        className={
          warning
            ? "mt-0.5 size-4 shrink-0 text-amber-500"
            : "mt-0.5 size-4 shrink-0 text-red-500"
        }
      />
      <Link to={to} className="hover:underline">
        {children}
      </Link>
    </li>
  );
}
