# Radan Integration

> **⚠️ Work in Progress**
>
> This integration is currently under development and may not be fully functional. Please check back later for updates.

## Setup

The integration involved two parts.

1. Enabling the integration in Carbon
2. Generating an API Key for the Radan client

### Enabling the integration in Carbon

1. In Carbon, navigate to Settings > Integrations
2. Install the Radan integration
3. Select the relevant processes (e.g. Laser, Plasma)

### Generating an API Key for the Radan client

1. In Carbon, navigate to Settings > API Key
2. Generate a new API Key and save it.

## Using the API

Now you can fetch data for the integration using your API key:

```bash
curl 'https://app.carbon.ms/api/integrations/radan/v1' \
-H "carbon-key: <your-api-key>"
```

Here's what an error looks like:

```json
{
  "success": false,
  "error": "Integration not active"
}
```

And here's what a success looks like:

> **⚠️ Heads Up!**
>
> There is no mechanism in Carbon to determine which file is relevant for nesting so we must send them all (in the documents array)

```json
{
  "success": true,
  "data": [
    {
      "id": "pjSnUdrsFZmWDbCN1hvi2",
      "assignee": null,
      "description": "Laser",
      "documents": [
        {
          "name": "X32329302.dxf",
          "id": "d44c320d-b792-49da-b0fc-954cd09ed044",
          "updated_at": "2025-09-02T12:39:03.795Z",
          "created_at": "2025-09-02T12:39:03.795Z",
          "last_accessed_at": "2025-09-02T12:39:03.795Z",
          "metadata": {
            "eTag": "\"8cddafa69a599294d7edd2ab359bc4ec\"",
            "size": 28450,
            "mimetype": "application/dxf",
            "cacheControl": "max-age=43200",
            "lastModified": "2025-09-02T12:39:03.788Z",
            "contentLength": 28450,
            "httpStatusCode": 200
          },
          "bucket": "parts"
        }
      ],
      "itemDescription": "X32329302",
      "itemId": "item_L2Pou8zCzNtZRzb9uyNMSD",
      "itemReadableId": "X32329302",
      "jobCustomerId": "cust_YVLo9Pkj2M9nShpwu5Ezaq",
      "jobDeadlineType": "Hard Deadline",
      "jobDueDate": "2025-05-15",
      "jobId": "job_PVuhmo2W16NBy2Zsn9Dpy5",
      "jobLocationName": "Headquarters",
      "jobMakeMethodId": "jmm_S6DhS6kyTqbEoLyAXBthHs",
      "jobReadableId": "J000001",
      "jobStatus": "Ready",
      "laborTime": 0,
      "laborUnit": "Minutes/Piece",
      "machineTime": 2,
      "machineUnit": "Minutes/Piece",
      "materialDimension": "1/4\"",
      "materialFinish": null,
      "materialForm": "Plate",
      "materialGrade": "A36",
      "materialItemDescription": "A36 Steel Plate 1/4\"",
      "materialItemReadableId": "A36-STEEL-PLT-1/4\"",
      "materialSubstance": "Steel",
      "operationOrder": 1,
      "operationOrderType": "After Previous",
      "operationQuantity": 20,
      "operationStatus": "Ready",
      "parentMaterialId": null,
      "priority": 1,
      "processId": "pr_D1sq4wcav2cixyzf7C9Xci",
      "quantityComplete": 0,
      "quantityScrapped": 0,
      "salesOrderId": "so_EjraNLcHiMNM7NzR9enVSC",
      "salesOrderLineId": "8U5bd4Hzzvxp59jkYjj64e",
      "salesOrderReadableId": "SO000001",
      "setupTime": 20,
      "setupUnit": "Total Minutes",
      "tags": [],
      "workCenterId": null
    }
  ]
}
```

## Webhook

A webhook will be implemented for the data to be returned that uses the same auth mechanism, but this will be determined at a later date.
