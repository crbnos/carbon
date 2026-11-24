---
paths: []
triggers: []
promoted: null
---
# A posting's refusal only reaches the dialog when it is thrown as a 4xx

**Context:** A refused receipt void showed "Failed to void receipt" with no reason. The guards inside the `post-receipt` posting said exactly why ("stock received on this receipt was moved, picked or shipped since it was received").

**Problem:** `invokePosting` reads a plain `Error` as status 500 (the posting's default), and the operation passed every failure to `serverFnFailure` with a fixed message. So every refusal, and every new guard, was reported with the same generic text.

**Rule:** Throw an authored refusal from a posting as `InvalidInputError` (or another `ServerFnError` below 500), never a plain `Error`. In the operation, below 500 return the error's own message (`error.message || <fallback>`); keep the generic message for 500, whose detail `toError` already withholds.

**Applies to:** every operation that calls `invokePosting` and every posting body (`voidReceipt` / `postReceipt` in `inventory.server.ts`, `adjustInventory` follows the same shape).
