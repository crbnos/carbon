#!/usr/bin/env bash
# Briefs the agent before each edit and refuses an edit a check would fail.
exec "$CLAUDE_PROJECT_DIR/packages/checks/node_modules/.bin/tsx" \
  "$CLAUDE_PROJECT_DIR/packages/checks/src/hooks/pre-tool-use.ts"
