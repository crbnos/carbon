import { serve } from "@novu/framework/remix";
import {
  assignmentWorkflow,
  digitalQuoteResponseWorkflow,
  expirationWorkflow,
  messageWorkflow,
} from "~/novu/workflows";

const handler = serve({
  workflows: [
    assignmentWorkflow,
    digitalQuoteResponseWorkflow,
    expirationWorkflow,
    messageWorkflow,
  ],
});

export const config = {
  runtime: "nodejs",
};

export { handler as action, handler as loader };
