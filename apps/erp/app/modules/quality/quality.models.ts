import { z } from "zod";
import { zfd } from "zod-form-data";

export const nonConformanceTypeValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
});
