---
paths: []
triggers: []
promoted: null
---
# A fetcher's failed load replaces the whole page

- **Context:** A modal loaded an optional extra (the values behind its pencils) with `useFetcher().load`.
- **Problem:** A loader that throws sends a fetcher's error to the nearest route boundary (`setFetcherError`). The record page became an error screen, and the modal and its unsaved draft went with it.
- **Rule:** When a page can work without the data, load it with a plain `fetch` and handle the failure there, or return the failure from the loader as data.
- **Applies to:** Every `fetcher.load` for something optional, especially behind unsaved work.
