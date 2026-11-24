---
paths: []
triggers: []
promoted: null
---
# A service-role job must check that a stored path belongs to the row's company

**Context:** The model jobs found a raw file by the company named in `modelUpload.modelPath` and read storage as the service role.

**Problem:** The forms insert `modelUpload` under RLS, and RLS does not check `modelPath`. So a row in one company could name another company's staged upload in the shared `temp-staging` bucket, and the optimise would copy that file into the first company's bucket.

**Rule:** A job that reads storage as the service role takes the company from the row, never from the path, and refuses a path outside `${companyId}/` (`resolveModelSourceBucket`). Test it with a real object and a positive control, so the test fails when the guard goes.

**Applies to:** `packages/jobs` storage reads keyed by a path a user can write, and every copy that picks a bucket (`copyAssetsToBackup` took the source bucket from the first path segment until 2026-10-17).
