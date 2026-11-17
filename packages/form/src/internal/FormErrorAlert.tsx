// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Alert,
  AlertDescription,
  AlertTitle,
  errorDescription
} from "@carbon/react";
import type { FormError } from "@carbon/utils";
import { useEffect, useRef } from "react";
import { LuCircleAlert } from "react-icons/lu";

/** A refused save, shown on the form itself so it is not missed. */
export function FormErrorAlert({ error }: { error: FormError }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);
  const description = errorDescription(error.message, error.reason);
  return (
    <Alert ref={ref} variant="destructive" className="mb-4">
      <LuCircleAlert />
      <AlertTitle>{error.message}</AlertTitle>
      {description && <AlertDescription>{description}</AlertDescription>}
    </Alert>
  );
}
