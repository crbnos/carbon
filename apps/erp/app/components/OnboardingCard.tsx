import { Card, CardContent, cn } from "@carbon/react";
import type { HTMLAttributes } from "react";

/**
 * The onboarding layout centres one card in a fixed-height box, so a step whose
 * fields outgrow a short viewport runs off the screen with its Next button
 * unreachable. These three pieces cap the card at the screen and scroll only its
 * body, keeping the title and the buttons put. All three are needed together —
 * that is why they live here rather than as a className on whichever step last
 * hit the bug.
 */
const OnboardingCard = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <Card className={cn("max-w-lg max-h-full", className)} {...props} />
);

/** The scrolling body. Everything outside it stays pinned. */
const OnboardingCardContent = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <CardContent
    className={cn("min-h-0 overflow-y-auto", className)}
    {...props}
  />
);

/**
 * For a step whose header/body/footer sit inside a form: the form is then the
 * flex column between the card and its body, and has to pass the height cap
 * through rather than absorb it.
 */
const onboardingFormClassName = "flex flex-col min-h-0";

export { OnboardingCard, OnboardingCardContent, onboardingFormClassName };
