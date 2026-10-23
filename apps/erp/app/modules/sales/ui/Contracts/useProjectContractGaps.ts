// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type {
  ProjectContractGap,
  ProjectContractGapInput
} from "../../sales.models";
import { projectContractGaps } from "../../sales.models";
import type { ContractRouteData } from "./types";

/** What the Review step's loader reads for a project contract: the facts a
 *  gap needs beyond the contract page's own data. */
export type ProjectContractReviewFacts = Omit<
  ProjectContractGapInput,
  "lines" | "currencyCode" | "residuals"
>;

export type ProjectContractReviewData = {
  facts: ProjectContractReviewFacts | null;
};

/** The gaps of a project contract while its Review step is open, or null:
 *  a service contract, or another step. The Review step and the setup
 *  footer's Confirm read the same list. */
export function useProjectContractGaps(
  id: string
): ProjectContractGap[] | null {
  const routeData = useRouteData<ContractRouteData>(path.to.contract(id));
  const review = useRouteData<ProjectContractReviewData>(
    path.to.contractSetup(id, "review")
  );
  if (!routeData || !review?.facts) return null;
  const { contract, lines, residuals } = routeData;
  return projectContractGaps({
    ...review.facts,
    lines,
    currencyCode: contract.currencyCode,
    residuals
  });
}
