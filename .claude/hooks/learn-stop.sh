#!/usr/bin/env bash
# Asks the agent once per session to run /learn on logged check failures.
exec "$CLAUDE_PROJECT_DIR/packages/checks/node_modules/.bin/tsx" \
  "$CLAUDE_PROJECT_DIR/packages/checks/src/hooks/stop.ts"
