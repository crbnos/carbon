---
paths: []
triggers: []
promoted: null
---
# A tag that points at a line is cleared by every write that removes the line

- **Context:** A serial unit on a shipment carries `Shipment` and `Shipment Line` in `trackedEntity.attributes`; posting ships the units tagged to the shipment.
- **Problem:** Deleting a line, deleting the shipment or re-sourcing a Draft removed the lines but left the tags. The post then shipped units no line asked for. A post-time filter hid the stale tag, so a test that checked only after posting still passed when the clear was removed.
- **Rule:** A tag must name a live record. Every write that deletes or rebuilds the record clears its tags in the same place, and the reader still ignores tags to dead records. Test the clear right after the write, before any reader that would also hide it, and remove the clear once to see the test go red.
- **Applies to:** `clearShipmentTags` callers (`deleteShipment`, `deleteShipmentLine`, the `create` re-source), `liveShipmentTags`, and any attribute that names another row (`Receipt Line`, `Job Make Method`).
