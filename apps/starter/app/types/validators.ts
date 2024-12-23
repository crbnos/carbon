import type { Validator } from "@carbon/form";
import { z } from "zod";

export type TypeOfValidator<U extends Validator<any>> = U extends Validator<
  infer T
>
  ? T
  : unknown;

export type Mode = "light" | "dark";

export const modeValidator = z.object({
  mode: z.enum(["light", "dark", "system"]),
});
