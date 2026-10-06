# Latest-main Change Notice Impact sync

Integrate only `4604fc87d72d35c7530d26ef502c73055ade6dc4` into the clean branch at `1b9ecb41fe7a39075eec414ad9db80668071dee4` with one normal local merge commit.

- [x] Verify preflight, local backup, pinned main and its sole parent.
- [x] Audit the 65-file upstream delta, 14-file feature overlap and migration frontier.
- [x] Merge without auto-commit; retain upstream runtime/migrations and existing Impact contracts.
- [x] Canonicalize catalogs and verify decoded Impact translations against the previous verified tree.
- [x] With the app stopped, run focused Impact/shared-model/scheduling tests, ERP typecheck and applicable Biome/conformance checks.
- [x] Review the complete delta, protected-file equality, conflict markers, staged tree and MERGE_HEAD.

After the reviewed tree is committed, verify ordered parents, all requested ancestors, clean state and live main. Stop without pushing. Keep `20261006122532_change-notice-impact-authz.sql` byte-identical. Apply no migrations and do not start the app. A build is needed only if a runtime compatibility edit or build-sensitive failure requires it.
