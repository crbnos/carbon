// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  consolePinInResponse,
  consoleTerminalResponse,
  type PinInBody
} from "@carbon/mes-core";
import { useMutation } from "@tanstack/react-query";
import { newIdempotencyKey } from "~/lib/api/client";
import { useAuth } from "~/lib/auth/AuthProvider";

/**
 * The three calls that make a tablet a shared terminal and put an operator on
 * it. Each one's result lands in `AuthProvider`, which is the only place the
 * two tokens live — in memory, never on disk.
 */

/** Turns this tablet into a shared terminal. */
export function useBecomeTerminal() {
  const { api, setTerminalToken } = useAuth();

  return useMutation({
    mutationFn: () =>
      api.request("/console/terminal", {
        method: "POST",
        schema: consoleTerminalResponse,
        idempotencyKey: newIdempotencyKey()
      }),
    onSuccess: (result) => setTerminalToken(result.terminalToken)
  });
}

/**
 * Pins an operator in.
 *
 * Deliberately NOT given an idempotency key, matching the endpoint: that
 * window fingerprints the request body with sha256 and keeps it for 24 hours,
 * and a 4-digit PIN has only 10,000 preimages — storing the fingerprint would
 * put the PIN within brute-force reach of anything that can read Redis.
 * Pinning in twice is harmless; it mints a second claim for the same operator.
 */
export function usePinIn() {
  const { api, setOperatorToken, setOperator } = useAuth();

  return useMutation({
    mutationFn: (body: PinInBody) =>
      api.request("/console/pin-in", {
        method: "POST",
        body,
        schema: consolePinInResponse
      }),
    onSuccess: (result) => {
      setOperatorToken(result.operatorToken);
      setOperator(result.operator);
    }
  });
}

/**
 * Pins the operator out.
 *
 * The token is dropped locally whether the call succeeds or not. There is no
 * server-side session to destroy — the call exists so the act is audited — and
 * a network failure must never leave the next person's work credited to an
 * operator who has gone home.
 */
export function usePinOut() {
  const { api, setOperatorToken, setOperator } = useAuth();

  return useMutation({
    mutationFn: async () => {
      try {
        await api.request("/console/pin-out", {
          method: "POST",
          idempotencyKey: newIdempotencyKey()
        });
      } finally {
        setOperatorToken(null);
        setOperator(null);
      }
    }
  });
}
