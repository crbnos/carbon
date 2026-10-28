// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getLogger } from "@carbon/logger";
import type { ReactNode } from "react";
import { Component } from "react";

const log = getLogger("react", "halloween");

/**
 * Renders nothing once a decoration throws or its chunk fails to load, so a
 * broken decoration never takes the app shell or the sign-in page down.
 * `onError` lets the owner undo what showing it changed.
 */
export class Optional extends Component<
  { children: ReactNode; onError?: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    log.error("Halloween decoration failed", { error });
    this.props.onError?.();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
