import { serve } from "@novu/framework/remix";
import {
  assignmentWorkflow,
  digitalQuoteResponseWorkflow,
  expirationWorkflow,
} from "~/novu/workflows";

const handler = serve({
  workflows: [
    assignmentWorkflow,
    digitalQuoteResponseWorkflow,
    expirationWorkflow,
  ],
});

export const config = {
  runtime: "nodejs",
};

export { handler as action, handler as loader };
