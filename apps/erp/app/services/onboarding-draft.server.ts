import { createCookieSessionStorage } from "react-router";

const ONBOARDING_DRAFT_KEY = "onboarding-draft";

const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: ONBOARDING_DRAFT_KEY,
    path: "/",
    secure: false,
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 // 24 hours
  }
});

export type OnboardingDraft = {
  industry?: {
    industryId: string;
    customIndustryDescription?: string;
    seedDemoData: boolean;
  };
  company?: {
    name?: string;
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    stateProvince?: string;
    postalCode?: string;
    countryCode?: string;
    baseCurrencyCode?: string;
    website?: string;
  };
};

export async function getOnboardingDraft(
  request: Request
): Promise<OnboardingDraft | null> {
  const session = await sessionStorage.getSession(
    request.headers.get("Cookie")
  );
  const draft = session.get(ONBOARDING_DRAFT_KEY) as
    | OnboardingDraft
    | undefined;
  return draft ?? null;
}

export async function setOnboardingDraft(
  request: Request,
  draft: Partial<OnboardingDraft>
): Promise<string> {
  const session = await sessionStorage.getSession(
    request.headers.get("Cookie")
  );
  const existingDraft =
    (session.get(ONBOARDING_DRAFT_KEY) as OnboardingDraft | undefined) ?? {};
  const updatedDraft = { ...existingDraft, ...draft };
  session.set(ONBOARDING_DRAFT_KEY, updatedDraft);
  return sessionStorage.commitSession(session);
}

export async function clearOnboardingDraft(request: Request): Promise<string> {
  const session = await sessionStorage.getSession(
    request.headers.get("Cookie")
  );
  session.set(ONBOARDING_DRAFT_KEY, undefined);
  return sessionStorage.commitSession(session);
}
