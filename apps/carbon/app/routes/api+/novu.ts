import { serve } from "@novu/framework/remix";
import {
  assignmentWorkflow,
  digitalQuoteResponseWorkflow,
} from "~/novu/workflows";

const handler = serve({
  workflows: [assignmentWorkflow, digitalQuoteResponseWorkflow],
});

export const config = {
  runtime: "nodejs",
};

export { handler as action, handler as loader };
