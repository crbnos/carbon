import { CarbonEdition } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { TooltipProvider, useMode } from "@carbon/react";
import { getStripeCustomerByCompanyId } from "@carbon/stripe/stripe.server";
import { Edition, isInternalEmail } from "@carbon/utils";
import { MeshGradient } from "@paper-design/shaders-react";
import { useEffect, useState } from "react";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";
import { Outlet, redirect } from "react-router";
import { useTheme } from "~/hooks/useTheme";
import { getLocationsList } from "~/modules/resources";
import { getCompany } from "~/modules/settings";
import { onboardingSequence, path } from "~/utils/path";

export const shouldRevalidate: ShouldRevalidateFunction = () => true;

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId, email } = await requirePermissions(
    request,
    {}
  );
  const isInternal = isInternalEmail(email);

  const [company, stripeCustomer, locations] = await Promise.all([
    getCompany(client, companyId),
    getStripeCustomerByCompanyId(companyId, userId),
    getLocationsList(client, companyId)
  ]);

  const pathname = new URL(request.url).pathname;

  if (company.data?.name && locations.data?.length) {
    if (CarbonEdition !== Edition.Cloud || stripeCustomer) {
      throw redirect(path.to.authenticatedRoot);
    }

    if (
      CarbonEdition === Edition.Cloud &&
      pathname !== path.to.onboarding.plan
    ) {
      throw redirect(path.to.onboarding.plan);
    }
  }

  // The data-choice step (demo template / backup import) is internal-only; the
  // plan step is Cloud-only. Everyone else creates their company in the company
  // step directly.
  const onboardingSteps = onboardingSequence.filter((p) => {
    if (p === path.to.onboarding.plan) return CarbonEdition === Edition.Cloud;
    if (p === path.to.onboarding.industry) return isInternal;
    return true;
  });

  const pathIndex = onboardingSteps.findIndex((p) => p === pathname);

  const previousPath =
    pathIndex === 0 ? undefined : onboardingSteps[pathIndex - 1];

  const nextPath =
    pathIndex === onboardingSteps.length - 1
      ? path.to.authenticatedRoot
      : onboardingSteps[pathIndex + 1];

  return {
    currentIndex: pathIndex,
    onboardingSteps: onboardingSteps.length,
    previousPath,
    nextPath
  };
}

const meshColorsByTheme: Record<
  string,
  {
    light: [string, string, string, string];
    dark: [string, string, string, string];
  }
> = {
  zinc: {
    light: ["#d4d4d8", "#f4f4f5", "#ffffff", "#e4e4e7"],
    dark: ["#18181b", "#000000", "#0D0D0D", "#050505"]
  },
  neutral: {
    light: ["#d6d3d1", "#f5f5f4", "#ffffff", "#e7e5e4"],
    dark: ["#1c1917", "#000000", "#0D0D0D", "#050505"]
  },
  red: {
    light: ["#fecdd3", "#fff1f2", "#ffffff", "#ffe4e6"],
    dark: ["#2d0a0a", "#000000", "#0D0D0D", "#050505"]
  },
  orange: {
    light: ["#fed7aa", "#fff7ed", "#ffffff", "#ffedd5"],
    dark: ["#2d1a0a", "#000000", "#0D0D0D", "#050505"]
  },
  yellow: {
    light: ["#fde68a", "#fefce8", "#ffffff", "#fef9c3"],
    dark: ["#2d2a0a", "#000000", "#0D0D0D", "#050505"]
  },
  green: {
    light: ["#a7f3d0", "#ecfdf5", "#ffffff", "#d1fae5"],
    dark: ["#023225", "#000000", "#0D0D0D", "#050505"]
  },
  blue: {
    light: ["#bdcdff", "#f7f5ff", "#ffffff", "#e6f3ff"],
    dark: ["#0a1a2d", "#000000", "#0D0D0D", "#050505"]
  },
  violet: {
    light: ["#c4b5fd", "#f5f3ff", "#ffffff", "#ede9fe"],
    dark: ["#1e0a2d", "#000000", "#0D0D0D", "#050505"]
  }
};

function getMeshColors(theme: string, mode: string) {
  const colors = meshColorsByTheme[theme] ?? meshColorsByTheme.blue;
  return mode === "light" ? colors.light : colors.dark;
}

function getBackgroundGradient(theme: string, mode: string) {
  const colors = getMeshColors(theme, mode);
  return `linear-gradient(to bottom right, ${colors[1]} 35.67%, ${colors[0]} 88.95%)`;
}

export default function OnboardingLayout() {
  const mode = useMode();
  const serverTheme = useTheme();
  const [theme, setTheme] = useState(serverTheme);

  useEffect(() => {
    setTheme(serverTheme);
  }, [serverTheme]);

  useEffect(() => {
    const handler = (e: Event) => {
      setTheme((e as CustomEvent<string>).detail);
    };
    window.addEventListener("onboarding-theme-change", handler);
    return () => window.removeEventListener("onboarding-theme-change", handler);
  }, []);

  const meshGradientColors = getMeshColors(theme, mode);
  const backgroundGradient = getBackgroundGradient(theme, mode);

  return (
    <TooltipProvider>
      <div className="relative h-screen w-screen">
        <div
          className="absolute inset-0"
          style={{ background: backgroundGradient }}
        >
          <MeshGradient
            speed={1}
            colors={meshGradientColors}
            distortion={0.8}
            swirl={0.1}
            grainMixer={0}
            grainOverlay={0}
            className="absolute inset-0 w-full h-full"
            style={{ height: "100%", width: "100%" }}
          />
        </div>
        <div className="relative z-10 flex h-full w-full items-center justify-center p-4">
          <Outlet />
        </div>
      </div>
    </TooltipProvider>
  );
}
