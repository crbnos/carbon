// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Second pass of migrate-private-buckets.ts. The first pass ran while the
// legacy `private` bucket was still writable, so files written there after it
// exist only in `private`. 20261002022403_private-bucket-read-only.sql closes the
// bucket to sessions and API keys in the same deploy, before this runs. The
// service role bypasses that policy, so this pass is final only while no
// service-role code writes to `private`.
//
// Same copy, new ledger name: the script is idempotent and skips objects that
// are already in the company bucket.
//
// Safe to remove once every deployment has run it.
import "./migrate-private-buckets";
