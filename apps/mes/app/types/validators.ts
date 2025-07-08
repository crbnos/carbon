import type { Validator } from "@carbon/form";

export type TypeOfValidator<U extends Validator<any>> = U extends Validator<
  infer T
>
  ? T
  : unknown;
