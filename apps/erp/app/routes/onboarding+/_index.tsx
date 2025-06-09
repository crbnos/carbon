import { Button, Heading, VStack } from "@carbon/react";
import { Link } from "@remix-run/react";
import { onboardingSequence } from "~/utils/path";

export default function GetStarted() {
  return (
    <VStack spacing={4} className="max-w-lg p-4 items-center text-center">
      <img
        src="/carbon-logo-mark.svg"
        alt="Carbon Logo"
        className="w-24 mb-3"
      />

      <Heading size="h1" className="m-0">
        Welcome to Carbon
      </Heading>
      <p className="text-muted-foreground text-balance text-sm pb-4">
        Carbon is a manufacturing platform that combines ERP, MES, and QMS into
        a single, unified system.
      </p>

      <Button size="lg" asChild>
        <Link to={onboardingSequence[0]}>Get Started</Link>
      </Button>
    </VStack>
  );
}
