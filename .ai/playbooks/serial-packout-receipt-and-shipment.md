# Receive and ship a serialized pack-out

Use an isolated local company. Enable **Take the serial number from the part** before creating the job. The sales part and production part both use serial tracking. Leave the sales part’s serial sequence blank. Give it one pack-out operation and one planned production part per sales unit. Receive two production units with the labels `SN-7` and ` SN-7 ` (one leading and one trailing space). Record their physical tracked-entity IDs and create a sales-part job for two units.

1. In MES, issue the padded production serial, then use **Give Back** before Log. Verify the input is available again and its sales output has lost the inherited number. Scan the same unit again and Log it. Give Back must now explain that the logged unit cannot be returned. The sales unit and its source keep separate IDs.
2. In ERP, open the job’s **Complete** dialog. Fail the job receipt snapshot request once in the browser. Verify the dialog offers Retry, cannot submit a receipt, and the job has no sales receipt. Restore the request and retry. Receive the padded serial, leaving the optional bin empty. Verify one receipt for that sales output and a job still open for its second piece.
3. Issue the plain production serial and Log the second piece. Verify two quantity-one sales receipts, each with the corresponding sales output ID.
4. On a one-piece stock sales shipment, open the serial picker. Identify both choices by their displayed names. The plain option reads `SN-7 · <sales output ID>`. The padded option reads `␠SN-7␠ · <sales output ID>`. Pick the plain one and reload. Replace it with the padded one and reload. The stored slot must now identify the padded unit.
5. Post the shipment. Check that the sales shipment ledger debits exactly one padded sales unit and that the plain unit remains available. The printed serial and database serial keep their original characters. Remove the fixture company and close the browser context.

The database regressions in `shipment-serial-selection.test.ts` and `job-unit-pairing-cost.test.ts` cover replaying the old shipment selection and shipping the cheaper of two units first.
