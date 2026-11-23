// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import useAccountingSubmodules from "~/modules/accounting/ui/useAccountingSubmodules";
import useDocumentsSubmodules from "~/modules/documents/ui/useDocumentsSubmodules";
import useInventorySubmodules from "~/modules/inventory/ui/useInventorySubmodules";
import useInvoicingSubmodules from "~/modules/invoicing/ui/useInvoicingSubmodules";
import useItemsSubmodules from "~/modules/items/ui/useItemsSubmodules";
import usePeopleSubmodules from "~/modules/people/ui/usePeopleSubmodules";
import useProductionSubmodules from "~/modules/production/ui/useProductionSubmodules";
import useProjectsSubmodules from "~/modules/projects/ui/useProjectsSubmodules";
import usePurchasingSubmodules from "~/modules/purchasing/ui/usePurchasingSubmodules";
import useQualitySubmodules from "~/modules/quality/ui/useQualitySubmodules";
import useResourcesSubmodules from "~/modules/resources/ui/useResourcesSubmodules";
import useSalesSubmodules from "~/modules/sales/ui/useSalesSubmodules";
import useServiceSubmodules from "~/modules/service/ui/useServiceSubmodules";
import useUsersSubmodules from "~/modules/users/ui/useUsersSubmodules";
import useWorkflowsSubmodules from "~/modules/workflows/ui/useWorkflowsSubmodules";
import type { RouteGroup } from "~/types";
import { path } from "~/utils/path";
import { moduleLanding } from "~/utils/submodule-visibility";
import { useModules, useSubmoduleLayout } from "./useModules";

/**
 * The sidebar groups of each module a user can hide sub-modules of, by module
 * key. Settings is pinned and Shop Floor has no sidebar, so neither has an entry.
 */
export function useModuleSubmodules(): Record<string, RouteGroup[]> {
  const accounting = useAccountingSubmodules();
  const documents = useDocumentsSubmodules();
  const inventory = useInventorySubmodules();
  const invoicing = useInvoicingSubmodules();
  const items = useItemsSubmodules();
  const people = usePeopleSubmodules();
  const production = useProductionSubmodules();
  const projects = useProjectsSubmodules();
  const purchasing = usePurchasingSubmodules();
  const quality = useQualitySubmodules();
  const resources = useResourcesSubmodules();
  const sales = useSalesSubmodules();
  const service = useServiceSubmodules();
  const users = useUsersSubmodules();
  const workflows = useWorkflowsSubmodules();

  return {
    accounting: accounting.groups,
    documents: [{ name: "", routes: documents.links }],
    inventory: inventory.groups,
    invoicing: invoicing.groups,
    parts: items.groups,
    people: people.groups,
    production: production.groups,
    projects: projects.groups,
    purchasing: purchasing.groups,
    quality: quality.groups,
    resources: resources.groups,
    sales: sales.groups,
    service: service.groups,
    users: users.groups,
    workflows: workflows.groups
  };
}

/**
 * The modules, each linking to where it should open for this user. Anything that
 * navigates to a module reads this. Stays out of the `~/hooks` barrel, because
 * the sub-module hooks import that barrel.
 */
export function useModuleLinks() {
  const modules = useModules();
  const submodules = useModuleSubmodules();
  const layout = useSubmoduleLayout();
  return modules.map((module) => ({
    ...module,
    to: moduleLanding(
      module.to,
      // `/x/accounting` only redirects to its reports.
      module.key === "accounting" ? path.to.reports : module.to,
      submodules[module.key] ?? [],
      layout
    )
  }));
}
