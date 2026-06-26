import { pageBySlug } from "../content/registry";
import type { NestedProductStep, StepDef } from "../types";
import {
  effectiveGateStatus,
  effectiveProductStatus,
  type Signals
} from "./overlay";

// The single next thing to do — drives the guided "Next step" surface so the hub
// points at one action instead of listing everything.
export interface NextAction {
  gateKey: string;
  gateTitle: string;
  gateNumber: number;
  title: string; // the action to take
  detail?: string;
  refSlug: string; // hub page that backs this gate
  refTitle: string; // that page's nav label (for the CTA)
  // Present when the next thing is a product action you do inside Carbon:
  productStep?: NestedProductStep;
}

export function nextAction(
  spine: StepDef[],
  states: Map<string, string>,
  signals: Signals
): NextAction | null {
  for (const step of spine) {
    if (effectiveGateStatus(step, states, signals) === "done") continue;

    const refTitle = pageBySlug(step.refSlug)?.navLabel ?? step.title;

    // First incomplete gate. Prefer its first incomplete embedded product step.
    const nextProduct = (step.nested ?? []).find(
      (n) => effectiveProductStatus(n, states, signals) !== "done"
    );

    if (nextProduct) {
      return {
        gateKey: step.key,
        gateTitle: step.title,
        gateNumber: step.n,
        title: nextProduct.label,
        detail: nextProduct.detail,
        refSlug: step.refSlug,
        refTitle,
        productStep: nextProduct
      };
    }

    return {
      gateKey: step.key,
      gateTitle: step.title,
      gateNumber: step.n,
      title: step.title,
      detail: step.desc,
      refSlug: step.refSlug,
      refTitle
    };
  }

  return null; // everything done
}
