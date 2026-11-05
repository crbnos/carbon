#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
# including ports, remain AGPLv3; serving them over a network requires releasing their source.
#
# SessionStart hook: in a Claude Code cloud session, boot the dev stack in the
# background so the agent can use the ERP. A local session is left alone.
set -euo pipefail
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi
exec bash "${CLAUDE_PROJECT_DIR:-.}/scripts/cloud-dev.sh"
