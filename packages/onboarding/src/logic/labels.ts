import type { Owner, StepDef, Tier } from "../types";

// The hub surface label adapts by tier: self-serve sees "Get Started", paying
// tiers see "Implementation" (matches Chase's onboarding-vs-implementation split).
export function labelForTier(tier: Tier): string {
  return tier === "self_serve" ? "Get Started" : "Implementation";
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
export function ownerLeadLabel(owner: Owner): string {
  if (owner === "you") return "You lead";
  if (owner === "carbon") return "Carbon leads";
  return "Carbon + you";
}
