import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { Owner, StepDef, Tier } from "../types";

// The hub surface label adapts by tier: self-serve sees "Get Started", paying
// tiers see "Implementation" (matches Chase's onboarding-vs-implementation split).
export function labelForTier(tier: Tier): MessageDescriptor {
  return tier === "self_serve" ? msg`Get Started` : msg`Implementation`;
}

// Resolve an owner for a tier. In self-serve there's no Carbon team — the
// customer does everything alone — so BOTH Carbon-led and shared ownership
// collapse to "You". Guided/enterprise keep the authored owner.
export function ownerForTier(owner: Owner, tier: Tier): Owner {
  if (tier === "self_serve" && owner !== "you") return "you";
  return owner;
}

// Who owns a step, adapted by tier (see ownerForTier).
export function ownerForStep(step: StepDef, tier: Tier): Owner {
  return ownerForTier(step.owner, tier);
}

// Past tense of an owner's lead role, for "{timing} · {…}" lines. Avoids the
// ungrammatical "You leads" the bare label produced.
export function ownerLeadLabel(owner: Owner): MessageDescriptor {
  if (owner === "you") return msg`You lead`;
  if (owner === "carbon") return msg`Carbon leads`;
  return msg`Carbon + you`;
}
