// GENERATED FILE — do not edit. Run `pnpm run generate:workflow-catalog`.

import type { BuiltAction, BuiltIntegration, BuiltOperation } from "./build";

export const WORKFLOW_ACTION_CATALOG: Record<string, BuiltAction> = {
  "customer.update": {
    inputs: {
      customer: { type: { kind: "entity", of: "customer" }, required: true },
      accountManagerId: {
        type: { kind: "entity", of: "user" },
        required: false
      },
      assignee: { type: { kind: "entity", of: "user" }, required: false },
      customerTypeId: {
        type: { kind: "primitive", of: "string" },
        required: false,
        scopeTable: "customerType"
      }
    },
    outputs: { record: { kind: "entity", of: "customer" } },
    batchable: true,
    permission: { "sales.customers": "Edit" },
    update: { entity: "customer" }
  },
  "item.update": {
    inputs: {
      item: { type: { kind: "entity", of: "item" }, required: true },
      name: {
        type: { kind: "primitive", of: "string" },
        required: false,
        notNull: true
      },
      assignee: { type: { kind: "entity", of: "user" }, required: false }
    },
    outputs: { record: { kind: "entity", of: "item" } },
    batchable: true,
    permission: [
      { "parts.parts": "Edit" },
      { "parts.materials": "Edit" },
      { "parts.tools": "Edit" },
      { "parts.consumables": "Edit" },
      { "parts.services": "Edit" }
    ],
    update: { entity: "item" }
  },
  "job.create": {
    inputs: {
      itemId: { type: { kind: "entity", of: "item" }, required: true },
      quantity: { type: { kind: "primitive", of: "number" }, required: true },
      dueDate: { type: { kind: "primitive", of: "date" }, required: false },
      salesOrderLineId: {
        type: { kind: "primitive", of: "string" },
        required: false
      }
    },
    outputs: { record: { kind: "entity", of: "job" } },
    batchable: true,
    permission: { "production.jobs": "Create" },
    call: "production_insertJob"
  },
  "job.update": {
    inputs: {
      job: { type: { kind: "entity", of: "job" }, required: true },
      dueDate: { type: { kind: "primitive", of: "date" }, required: false },
      startDate: { type: { kind: "primitive", of: "date" }, required: false },
      assignee: { type: { kind: "entity", of: "user" }, required: false },
      priority: {
        type: { kind: "primitive", of: "number" },
        required: false,
        notNull: true
      },
      deadlineType: {
        type: { kind: "primitive", of: "string" },
        required: false,
        notNull: true,
        choices: ["No Deadline", "ASAP", "Soft Deadline", "Hard Deadline"]
      }
    },
    outputs: { record: { kind: "entity", of: "job" } },
    batchable: true,
    permission: { "production.jobs": "Edit" },
    update: { entity: "job" }
  },
  "nonConformance.create": {
    inputs: {
      name: { type: { kind: "primitive", of: "string" }, required: true },
      description: {
        type: { kind: "primitive", of: "string" },
        required: false
      },
      priority: {
        type: { kind: "primitive", of: "string" },
        required: true,
        choices: ["Low", "Medium", "High", "Critical"]
      },
      source: {
        type: { kind: "primitive", of: "string" },
        required: true,
        choices: ["Internal", "External"]
      },
      locationId: { type: { kind: "entity", of: "location" }, required: true },
      nonConformanceTypeId: {
        type: { kind: "entity", of: "nonConformanceType" },
        required: true
      },
      openDate: { type: { kind: "primitive", of: "date" }, required: false }
    },
    outputs: { record: { kind: "entity", of: "nonConformance" } },
    batchable: true,
    permission: { "quality.issues": "Create" },
    call: "quality_insertIssue"
  },
  "nonConformance.update": {
    inputs: {
      nonConformance: {
        type: { kind: "entity", of: "nonConformance" },
        required: true
      },
      assignee: { type: { kind: "entity", of: "user" }, required: false },
      priority: {
        type: { kind: "primitive", of: "string" },
        required: false,
        choices: ["Low", "Medium", "High", "Critical"]
      },
      dueDate: { type: { kind: "primitive", of: "date" }, required: false },
      nonConformanceTypeId: {
        type: { kind: "entity", of: "nonConformanceType" },
        required: false,
        notNull: true
      }
    },
    outputs: { record: { kind: "entity", of: "nonConformance" } },
    batchable: true,
    permission: { "quality.issues": "Edit" },
    update: { entity: "nonConformance" }
  },
  notify: {
    inputs: {
      user: { type: { kind: "entity", of: "user" }, required: false },
      role: { type: { kind: "entity", of: "group" }, required: false },
      channels: {
        type: { kind: "list", of: { kind: "primitive", of: "string" } },
        required: false,
        choices: ["inApp", "email", "slack"],
        defaultValue: ["inApp", "email"]
      },
      subject: {
        type: { kind: "primitive", of: "string" },
        required: true,
        template: true
      },
      message: {
        type: { kind: "primitive", of: "string" },
        required: false,
        template: true,
        links: { format: "markdown" }
      },
      aboutId: { type: { kind: "primitive", of: "string" }, required: false },
      aboutType: { type: { kind: "primitive", of: "string" }, required: false }
    },
    outputs: {},
    batchable: true,
    permission: [{ "users.accounts": "View" }, { "users.groups": "View" }],
    requireOneOf: [["user", "role"]]
  },
  "purchaseOrder.create": {
    inputs: {
      supplierId: { type: { kind: "entity", of: "supplier" }, required: true },
      orderDate: { type: { kind: "primitive", of: "date" }, required: false },
      supplierReference: {
        type: { kind: "primitive", of: "string" },
        required: false
      }
    },
    outputs: { record: { kind: "entity", of: "purchaseOrder" } },
    batchable: true,
    permission: { "purchasing.purchaseOrders": "Create" },
    call: "purchasing_insertPurchaseOrder"
  },
  "purchaseOrder.update": {
    inputs: {
      purchaseOrder: {
        type: { kind: "entity", of: "purchaseOrder" },
        required: true
      },
      supplierReference: {
        type: { kind: "primitive", of: "string" },
        required: false
      },
      orderDate: { type: { kind: "primitive", of: "date" }, required: false },
      assignee: { type: { kind: "entity", of: "user" }, required: false }
    },
    outputs: { record: { kind: "entity", of: "purchaseOrder" } },
    batchable: true,
    permission: { "purchasing.purchaseOrders": "Edit" },
    update: { entity: "purchaseOrder" }
  },
  "quote.update": {
    inputs: {
      quote: { type: { kind: "entity", of: "quote" }, required: true },
      expirationDate: {
        type: { kind: "primitive", of: "date" },
        required: false
      },
      dueDate: { type: { kind: "primitive", of: "date" }, required: false },
      assignee: { type: { kind: "entity", of: "user" }, required: false },
      estimatorId: { type: { kind: "entity", of: "user" }, required: false },
      salesPersonId: { type: { kind: "entity", of: "user" }, required: false },
      customerReference: {
        type: { kind: "primitive", of: "string" },
        required: false
      }
    },
    outputs: { record: { kind: "entity", of: "quote" } },
    batchable: true,
    permission: { "sales.quotes": "Edit" },
    update: { entity: "quote" }
  },
  "receipt.update": {
    inputs: {
      receipt: { type: { kind: "entity", of: "receipt" }, required: true },
      assignee: { type: { kind: "entity", of: "user" }, required: false }
    },
    outputs: { record: { kind: "entity", of: "receipt" } },
    batchable: true,
    permission: { "inventory.receipts": "Edit" },
    update: { entity: "receipt" }
  },
  "salesOrder.create": {
    inputs: {
      customerId: { type: { kind: "entity", of: "customer" }, required: true },
      orderDate: { type: { kind: "primitive", of: "date" }, required: false },
      customerReference: {
        type: { kind: "primitive", of: "string" },
        required: false
      }
    },
    outputs: { record: { kind: "entity", of: "salesOrder" } },
    batchable: true,
    permission: { "sales.salesOrders": "Create" },
    call: "sales_insertSalesOrder"
  },
  "salesOrder.update": {
    inputs: {
      salesOrder: {
        type: { kind: "entity", of: "salesOrder" },
        required: true
      },
      customerReference: {
        type: { kind: "primitive", of: "string" },
        required: false
      },
      orderDate: { type: { kind: "primitive", of: "date" }, required: false },
      assignee: { type: { kind: "entity", of: "user" }, required: false },
      salesPersonId: { type: { kind: "entity", of: "user" }, required: false }
    },
    outputs: { record: { kind: "entity", of: "salesOrder" } },
    batchable: true,
    permission: { "sales.salesOrders": "Edit" },
    update: { entity: "salesOrder" }
  },
  "shipment.update": {
    inputs: {
      shipment: { type: { kind: "entity", of: "shipment" }, required: true },
      trackingNumber: {
        type: { kind: "primitive", of: "string" },
        required: false
      },
      assignee: { type: { kind: "entity", of: "user" }, required: false },
      shippingMethodId: {
        type: { kind: "primitive", of: "string" },
        required: false,
        scopeTable: "shippingMethod"
      }
    },
    outputs: { record: { kind: "entity", of: "shipment" } },
    batchable: true,
    permission: { "inventory.shipments": "Edit" },
    update: { entity: "shipment" }
  },
  "supplier.update": {
    inputs: {
      supplier: { type: { kind: "entity", of: "supplier" }, required: true },
      accountManagerId: {
        type: { kind: "entity", of: "user" },
        required: false
      },
      assignee: { type: { kind: "entity", of: "user" }, required: false },
      supplierTypeId: {
        type: { kind: "primitive", of: "string" },
        required: false,
        scopeTable: "supplierType"
      }
    },
    outputs: { record: { kind: "entity", of: "supplier" } },
    batchable: true,
    permission: { "purchasing.suppliers": "Edit" },
    update: { entity: "supplier" }
  },
  webhook: {
    inputs: {
      url: { type: { kind: "primitive", of: "string" }, required: true },
      method: {
        type: { kind: "primitive", of: "string" },
        required: true,
        choices: ["GET", "POST", "PUT", "PATCH", "DELETE"],
        defaultValue: "GET"
      },
      headers: {
        type: { kind: "primitive", of: "string" },
        required: false,
        pairs: true
      },
      body: {
        type: { kind: "primitive", of: "string" },
        required: false,
        template: true,
        showWhen: { input: "method", equals: ["POST", "PUT", "PATCH"] }
      }
    },
    outputs: { status: { kind: "primitive", of: "number" } },
    batchable: true,
    permission: { "workflows.workflows": "Edit" }
  }
};

export const WORKFLOW_INTEGRATION_CATALOG: Record<string, BuiltIntegration> = {
  "integration.gmail.gmail_send_email": {
    inputs: {
      connectionId: {
        type: { kind: "primitive", of: "string" },
        required: true,
        options: {
          provider: "integration.connection",
          params: { piece: "gmail" }
        }
      },
      receiver: {
        type: { kind: "list", of: { kind: "primitive", of: "string" } },
        required: true
      },
      cc: {
        type: { kind: "list", of: { kind: "primitive", of: "string" } },
        required: false
      },
      bcc: {
        type: { kind: "list", of: { kind: "primitive", of: "string" } },
        required: false
      },
      subject: { type: { kind: "primitive", of: "string" }, required: true },
      body: {
        type: { kind: "primitive", of: "string" },
        required: true,
        description: "Body for the email you want to send",
        template: true,
        links: {
          format: "html",
          when: { input: "body_type", equals: ["html"] }
        }
      },
      reply_to: {
        type: { kind: "list", of: { kind: "primitive", of: "string" } },
        required: false,
        description: 'Email address to set as the "Reply-To" header'
      },
      sender_name: {
        type: { kind: "primitive", of: "string" },
        required: false
      },
      from: {
        type: { kind: "primitive", of: "string" },
        required: false,
        description:
          "The address must be listed in your GMail account's settings"
      }
    },
    advancedInputs: {
      body_type: {
        type: { kind: "primitive", of: "string" },
        required: false,
        choices: ["plain_text", "html"],
        defaultValue: "plain_text"
      }
    },
    outputs: {
      data: {
        kind: "record",
        fields: {
          id: { kind: "primitive", of: "string" },
          threadId: { kind: "primitive", of: "string" },
          labelIds: { kind: "primitive", of: "string" }
        }
      },
      status: { kind: "primitive", of: "number" },
      statusText: { kind: "primitive", of: "string" },
      count: { kind: "primitive", of: "number" },
      result: { kind: "primitive", of: "string" }
    },
    batchable: false,
    permission: { "workflows.workflows": "Edit" },
    piece: { name: "gmail", action: "gmail_send_email" }
  },
  "integration.google-calendar.create_google_calendar_event": {
    inputs: {
      connectionId: {
        type: { kind: "primitive", of: "string" },
        required: true,
        options: {
          provider: "integration.connection",
          params: { piece: "google-calendar" }
        }
      },
      calendar_id: {
        type: { kind: "primitive", of: "string" },
        required: true,
        options: {
          provider: "integration.property",
          params: {
            piece: "google-calendar",
            action: "create_google_calendar_event",
            prop: "calendar_id"
          },
          dependsOn: ["connectionId"]
        }
      },
      title: { type: { kind: "primitive", of: "string" }, required: true },
      start_date_time: {
        type: { kind: "primitive", of: "date" },
        required: true,
        precision: "datetime"
      },
      end_date_time: {
        type: { kind: "primitive", of: "date" },
        required: false,
        description: "By default it'll be 30 min post start time",
        precision: "datetime"
      },
      location: { type: { kind: "primitive", of: "string" }, required: false },
      description: {
        type: { kind: "primitive", of: "string" },
        required: false,
        description: "Description of the event. You can use HTML tags here.",
        template: true
      },
      colorId: {
        type: { kind: "primitive", of: "string" },
        required: false,
        options: {
          provider: "integration.property",
          params: {
            piece: "google-calendar",
            action: "create_google_calendar_event",
            prop: "colorId"
          },
          dependsOn: ["connectionId"]
        }
      },
      attendees: {
        type: { kind: "list", of: { kind: "primitive", of: "string" } },
        required: false,
        description: "Emails of the attendees (guests)"
      },
      guests_can_modify: {
        type: { kind: "primitive", of: "boolean" },
        required: false,
        defaultValue: false
      },
      guests_can_invite_others: {
        type: { kind: "primitive", of: "boolean" },
        required: false,
        defaultValue: false
      },
      guests_can_see_other_guests: {
        type: { kind: "primitive", of: "boolean" },
        required: false,
        defaultValue: false
      },
      create_meet_link: {
        type: { kind: "primitive", of: "boolean" },
        required: false,
        defaultValue: false,
        description:
          "Automatically create a Google Meet video conference link for this event"
      }
    },
    advancedInputs: {
      send_notifications: {
        type: { kind: "primitive", of: "string" },
        required: false,
        choices: ["all", "externalOnly", "none"],
        defaultValue: "all"
      }
    },
    outputs: {
      summary: { kind: "primitive", of: "string" },
      status: { kind: "primitive", of: "string" },
      htmlLink: { kind: "primitive", of: "string" },
      id: { kind: "primitive", of: "string" },
      eventType: { kind: "primitive", of: "string" },
      start: {
        kind: "record",
        fields: {
          dateTime: { kind: "primitive", of: "date" },
          timeZone: { kind: "primitive", of: "string" }
        }
      },
      end: {
        kind: "record",
        fields: {
          dateTime: { kind: "primitive", of: "date" },
          timeZone: { kind: "primitive", of: "string" }
        }
      },
      creator: {
        kind: "record",
        fields: { email: { kind: "primitive", of: "string" } }
      },
      organizer: {
        kind: "record",
        fields: { email: { kind: "primitive", of: "string" } }
      },
      created: { kind: "primitive", of: "date" },
      updated: { kind: "primitive", of: "date" },
      iCalUID: { kind: "primitive", of: "string" },
      count: { kind: "primitive", of: "number" },
      result: { kind: "primitive", of: "string" }
    },
    batchable: false,
    permission: { "workflows.workflows": "Edit" },
    piece: { name: "google-calendar", action: "create_google_calendar_event" }
  },
  "integration.google-calendar.google_calendar_get_events": {
    inputs: {
      connectionId: {
        type: { kind: "primitive", of: "string" },
        required: true,
        options: {
          provider: "integration.connection",
          params: { piece: "google-calendar" }
        }
      },
      calendar_id: {
        type: { kind: "primitive", of: "string" },
        required: true,
        options: {
          provider: "integration.property",
          params: {
            piece: "google-calendar",
            action: "google_calendar_get_events",
            prop: "calendar_id"
          },
          dependsOn: ["connectionId"]
        }
      },
      search: { type: { kind: "primitive", of: "string" }, required: false },
      start_date: {
        type: { kind: "primitive", of: "date" },
        required: false,
        precision: "datetime"
      },
      end_date: {
        type: { kind: "primitive", of: "date" },
        required: false,
        precision: "datetime"
      }
    },
    advancedInputs: {
      event_types: {
        type: { kind: "list", of: { kind: "primitive", of: "string" } },
        required: false,
        choices: ["default", "outOfOffice", "focusTime", "workingLocation"],
        defaultValue: ["default", "focusTime", "outOfOffice"],
        description: "Select event types"
      },
      singleEvents: {
        type: { kind: "primitive", of: "boolean" },
        required: false,
        defaultValue: true,
        description:
          "Whether to expand recurring events into instances and only return single one-off events and instances of recurring events, but not the underlying recurring events themselves."
      }
    },
    outputs: {
      status: { kind: "primitive", of: "string" },
      summary: { kind: "primitive", of: "string" },
      timeZone: { kind: "primitive", of: "string" },
      accessRole: { kind: "primitive", of: "string" },
      updated: { kind: "primitive", of: "date" },
      items: {
        kind: "list",
        of: {
          kind: "record",
          fields: {
            summary: { kind: "primitive", of: "string" },
            status: { kind: "primitive", of: "string" },
            id: { kind: "primitive", of: "string" },
            eventType: { kind: "primitive", of: "string" },
            htmlLink: { kind: "primitive", of: "string" },
            startDateTime: { kind: "primitive", of: "date" },
            endDateTime: { kind: "primitive", of: "date" },
            creatorEmail: { kind: "primitive", of: "string" },
            organizerEmail: { kind: "primitive", of: "string" },
            created: { kind: "primitive", of: "date" },
            updated: { kind: "primitive", of: "date" },
            iCalUID: { kind: "primitive", of: "string" }
          }
        }
      },
      count: { kind: "primitive", of: "number" },
      result: { kind: "primitive", of: "string" }
    },
    batchable: false,
    permission: { "workflows.workflows": "Edit" },
    piece: { name: "google-calendar", action: "google_calendar_get_events" }
  },
  "integration.slack.send_channel_message": {
    inputs: {
      connectionId: {
        type: { kind: "primitive", of: "string" },
        required: true,
        options: {
          provider: "integration.connection",
          params: { piece: "slack" }
        }
      },
      channel: {
        type: { kind: "primitive", of: "string" },
        required: true,
        description:
          "You can get the Channel ID by right-clicking on the channel and selecting 'View Channel Details.'",
        options: {
          provider: "integration.property",
          params: {
            piece: "slack",
            action: "send_channel_message",
            prop: "channel"
          },
          dependsOn: ["connectionId"]
        }
      },
      text: {
        type: { kind: "primitive", of: "string" },
        required: false,
        description:
          "The text of your message. When using Block Kit blocks, this is used as a fallback for notifications.",
        template: true,
        links: { format: "slack" }
      },
      threadTs: {
        type: { kind: "primitive", of: "string" },
        required: false,
        description:
          "Provide the ts (timestamp) or link value of the **parent** message to make this message a reply. Do not use the ts value of the reply itself; use its parent instead. For example '1710304378.475129'.Alternatively, you can easily obtain the message link by clicking on the three dots next to the parent message and selecting the 'Copy link' option."
      },
      username: {
        type: { kind: "primitive", of: "string" },
        required: false,
        description: "The username of the bot"
      },
      profilePicture: {
        type: { kind: "primitive", of: "string" },
        required: false,
        description: "The profile picture of the bot"
      },
      iconEmoji: {
        type: { kind: "primitive", of: "string" },
        required: false,
        description: "The icon emoji of the bot"
      },
      replyBroadcast: {
        type: { kind: "primitive", of: "boolean" },
        required: false,
        defaultValue: false,
        description:
          "When replying to a thread, also make the message visible to everyone in the channel (only applicable when Thread Timestamp is provided)"
      },
      unfurlLinks: {
        type: { kind: "primitive", of: "boolean" },
        required: false,
        defaultValue: true,
        description: "Enable link unfurling for this message"
      }
    },
    outputs: {
      channel: { kind: "primitive", of: "string" },
      ts: { kind: "primitive", of: "string" },
      message: {
        kind: "record",
        fields: {
          ts: { kind: "primitive", of: "string" },
          user: { kind: "primitive", of: "string" },
          text: { kind: "primitive", of: "string" },
          type: { kind: "primitive", of: "string" },
          subtype: { kind: "primitive", of: "string" },
          bot_id: { kind: "primitive", of: "string" },
          team: { kind: "primitive", of: "string" },
          thread_ts: { kind: "primitive", of: "string" },
          reply_count: { kind: "primitive", of: "number" },
          reply_users_count: { kind: "primitive", of: "number" },
          latest_reply: { kind: "primitive", of: "string" },
          is_locked: { kind: "primitive", of: "boolean" },
          edited: {
            kind: "record",
            fields: {
              user: { kind: "primitive", of: "string" },
              ts: { kind: "primitive", of: "string" }
            }
          },
          reactions: {
            kind: "list",
            of: {
              kind: "record",
              fields: {
                name: { kind: "primitive", of: "string" },
                count: { kind: "primitive", of: "number" }
              }
            }
          }
        }
      },
      count: { kind: "primitive", of: "number" },
      result: { kind: "primitive", of: "string" }
    },
    batchable: false,
    permission: { "workflows.workflows": "Edit" },
    piece: { name: "slack", action: "send_channel_message" }
  },
  "integration.slack.send_direct_message": {
    inputs: {
      connectionId: {
        type: { kind: "primitive", of: "string" },
        required: true,
        options: {
          provider: "integration.connection",
          params: { piece: "slack" }
        }
      },
      userId: {
        type: { kind: "primitive", of: "string" },
        required: true,
        options: {
          provider: "integration.property",
          params: {
            piece: "slack",
            action: "send_direct_message",
            prop: "userId"
          },
          dependsOn: ["connectionId"]
        }
      },
      text: {
        type: { kind: "primitive", of: "string" },
        required: true,
        template: true,
        links: { format: "slack" }
      },
      username: {
        type: { kind: "primitive", of: "string" },
        required: false,
        description: "The username of the bot"
      },
      profilePicture: {
        type: { kind: "primitive", of: "string" },
        required: false,
        description: "The profile picture of the bot"
      },
      iconEmoji: {
        type: { kind: "primitive", of: "string" },
        required: false,
        description: "The icon emoji of the bot"
      },
      unfurlLinks: {
        type: { kind: "primitive", of: "boolean" },
        required: false,
        defaultValue: true,
        description: "Enable link unfurling for this message"
      }
    },
    outputs: {
      channel: { kind: "primitive", of: "string" },
      ts: { kind: "primitive", of: "string" },
      message: {
        kind: "record",
        fields: {
          ts: { kind: "primitive", of: "string" },
          user: { kind: "primitive", of: "string" },
          text: { kind: "primitive", of: "string" },
          type: { kind: "primitive", of: "string" },
          subtype: { kind: "primitive", of: "string" },
          bot_id: { kind: "primitive", of: "string" },
          team: { kind: "primitive", of: "string" },
          thread_ts: { kind: "primitive", of: "string" },
          reply_count: { kind: "primitive", of: "number" },
          reply_users_count: { kind: "primitive", of: "number" },
          latest_reply: { kind: "primitive", of: "string" },
          is_locked: { kind: "primitive", of: "boolean" },
          edited: {
            kind: "record",
            fields: {
              user: { kind: "primitive", of: "string" },
              ts: { kind: "primitive", of: "string" }
            }
          },
          reactions: {
            kind: "list",
            of: {
              kind: "record",
              fields: {
                name: { kind: "primitive", of: "string" },
                count: { kind: "primitive", of: "number" }
              }
            }
          }
        }
      },
      count: { kind: "primitive", of: "number" },
      result: { kind: "primitive", of: "string" }
    },
    batchable: false,
    permission: { "workflows.workflows": "Edit" },
    piece: { name: "slack", action: "send_direct_message" }
  },
  "integration.slack.slack-create-channel": {
    inputs: {
      connectionId: {
        type: { kind: "primitive", of: "string" },
        required: true,
        options: {
          provider: "integration.connection",
          params: { piece: "slack" }
        }
      },
      channelName: {
        type: { kind: "primitive", of: "string" },
        required: true
      },
      isPrivate: {
        type: { kind: "primitive", of: "boolean" },
        required: false,
        defaultValue: false
      }
    },
    outputs: {
      channel: {
        kind: "record",
        fields: {
          id: { kind: "primitive", of: "string" },
          name: { kind: "primitive", of: "string" },
          is_channel: { kind: "primitive", of: "boolean" },
          is_group: { kind: "primitive", of: "boolean" },
          is_private: { kind: "primitive", of: "boolean" },
          is_archived: { kind: "primitive", of: "boolean" },
          is_general: { kind: "primitive", of: "boolean" },
          is_member: { kind: "primitive", of: "boolean" },
          is_shared: { kind: "primitive", of: "boolean" },
          created: { kind: "primitive", of: "number" },
          creator: { kind: "primitive", of: "string" },
          num_members: { kind: "primitive", of: "number" },
          topic: {
            kind: "record",
            fields: {
              value: { kind: "primitive", of: "string" },
              creator: { kind: "primitive", of: "string" },
              last_set: { kind: "primitive", of: "number" }
            }
          },
          purpose: {
            kind: "record",
            fields: {
              value: { kind: "primitive", of: "string" },
              creator: { kind: "primitive", of: "string" },
              last_set: { kind: "primitive", of: "number" }
            }
          },
          previous_names: { kind: "primitive", of: "string" }
        }
      },
      count: { kind: "primitive", of: "number" },
      result: { kind: "primitive", of: "string" }
    },
    batchable: false,
    permission: { "workflows.workflows": "Edit" },
    piece: { name: "slack", action: "slack-create-channel" }
  },
  "integration.slack.slack-find-user-by-email": {
    inputs: {
      connectionId: {
        type: { kind: "primitive", of: "string" },
        required: true,
        options: {
          provider: "integration.connection",
          params: { piece: "slack" }
        }
      },
      email: { type: { kind: "primitive", of: "string" }, required: true }
    },
    outputs: {
      user: {
        kind: "record",
        fields: {
          id: { kind: "primitive", of: "string" },
          name: { kind: "primitive", of: "string" },
          real_name: { kind: "primitive", of: "string" },
          deleted: { kind: "primitive", of: "boolean" },
          is_admin: { kind: "primitive", of: "boolean" },
          is_owner: { kind: "primitive", of: "boolean" },
          is_bot: { kind: "primitive", of: "boolean" },
          is_restricted: { kind: "primitive", of: "boolean" },
          tz: { kind: "primitive", of: "string" },
          profile: {
            kind: "record",
            fields: {
              email: { kind: "primitive", of: "string" },
              real_name: { kind: "primitive", of: "string" },
              display_name: { kind: "primitive", of: "string" },
              title: { kind: "primitive", of: "string" },
              phone: { kind: "primitive", of: "string" },
              image_192: { kind: "primitive", of: "string" },
              status_text: { kind: "primitive", of: "string" },
              status_emoji: { kind: "primitive", of: "string" },
              first_name: { kind: "primitive", of: "string" },
              last_name: { kind: "primitive", of: "string" }
            }
          }
        }
      },
      count: { kind: "primitive", of: "number" },
      result: { kind: "primitive", of: "string" }
    },
    batchable: false,
    permission: { "workflows.workflows": "Edit" },
    piece: { name: "slack", action: "slack-find-user-by-email" }
  }
};

export const WORKFLOW_OPERATION_CATALOG: Record<string, BuiltOperation> = {
  "item.quantityOnHand": {
    entity: "item",
    inputs: { item: { type: { kind: "entity", of: "item" }, required: true } },
    output: { kind: "primitive", of: "number" },
    permission: [
      { "parts.parts": "View" },
      { "parts.materials": "View" },
      { "parts.tools": "View" },
      { "parts.consumables": "View" },
      { "parts.services": "View" }
    ]
  },
  "job.earliestOperationStart": {
    entity: "job",
    inputs: { job: { type: { kind: "entity", of: "job" }, required: true } },
    output: { kind: "primitive", of: "date" },
    permission: { "production.jobs": "View" }
  },
  "job.latestOperationEnd": {
    entity: "job",
    inputs: { job: { type: { kind: "entity", of: "job" }, required: true } },
    output: { kind: "primitive", of: "date" },
    permission: { "production.jobs": "View" }
  },
  "job.openOperationCount": {
    entity: "job",
    inputs: { job: { type: { kind: "entity", of: "job" }, required: true } },
    output: { kind: "primitive", of: "number" },
    permission: { "production.jobs": "View" }
  },
  "job.operationCount": {
    entity: "job",
    inputs: { job: { type: { kind: "entity", of: "job" }, required: true } },
    output: { kind: "primitive", of: "number" },
    permission: { "production.jobs": "View" }
  },
  "job.scrapPercentage": {
    entity: "job",
    inputs: { job: { type: { kind: "entity", of: "job" }, required: true } },
    output: { kind: "primitive", of: "number" },
    permission: { "production.jobs": "View" }
  },
  "job.totalScrapQuantity": {
    entity: "job",
    inputs: { job: { type: { kind: "entity", of: "job" }, required: true } },
    output: { kind: "primitive", of: "number" },
    permission: { "production.jobs": "View" }
  },
  "nonConformance.openTaskCount": {
    entity: "nonConformance",
    inputs: {
      nonConformance: {
        type: { kind: "entity", of: "nonConformance" },
        required: true
      }
    },
    output: { kind: "primitive", of: "number" },
    permission: { "quality.issues": "View" }
  },
  "purchaseOrder.lineCount": {
    entity: "purchaseOrder",
    inputs: {
      purchaseOrder: {
        type: { kind: "entity", of: "purchaseOrder" },
        required: true
      }
    },
    output: { kind: "primitive", of: "number" },
    permission: { "purchasing.purchaseOrders": "View" }
  },
  "purchaseOrder.total": {
    entity: "purchaseOrder",
    inputs: {
      purchaseOrder: {
        type: { kind: "entity", of: "purchaseOrder" },
        required: true
      }
    },
    output: { kind: "primitive", of: "number" },
    permission: { "purchasing.purchaseOrders": "View" }
  },
  "quote.total": {
    entity: "quote",
    inputs: {
      quote: { type: { kind: "entity", of: "quote" }, required: true }
    },
    output: { kind: "primitive", of: "number" },
    permission: { "sales.quotes": "View" }
  },
  "receipt.lineCount": {
    entity: "receipt",
    inputs: {
      receipt: { type: { kind: "entity", of: "receipt" }, required: true }
    },
    output: { kind: "primitive", of: "number" },
    permission: { "inventory.receipts": "View" }
  },
  "salesOrder.lineCount": {
    entity: "salesOrder",
    inputs: {
      salesOrder: { type: { kind: "entity", of: "salesOrder" }, required: true }
    },
    output: { kind: "primitive", of: "number" },
    permission: { "sales.salesOrders": "View" }
  },
  "salesOrder.total": {
    entity: "salesOrder",
    inputs: {
      salesOrder: { type: { kind: "entity", of: "salesOrder" }, required: true }
    },
    output: { kind: "primitive", of: "number" },
    permission: { "sales.salesOrders": "View" }
  },
  "shipment.lineCount": {
    entity: "shipment",
    inputs: {
      shipment: { type: { kind: "entity", of: "shipment" }, required: true }
    },
    output: { kind: "primitive", of: "number" },
    permission: { "inventory.shipments": "View" }
  }
};
