// This file is generated with the following command:
// npx swagger-typescript-api -p ~/Downloads/openapi.yaml -o ~/Downloads/
// Download the openapi.yaml file from https://docs.paperlessparts.com/v2

/**
 * The text identifier (slug) for the account
 * @example "acme-machining"
 */
export type AccountLocator = string;

/**
 * The name of the table
 * @example "sample_table"
 */
export type TableName = string;

/**
 * The account id
 * @example "13"
 */
export type AccountId = number;

/**
 * The billing address id
 * @example "27"
 */
export type BillingAddressId = number;

/**
 * The customer id
 * @example "32"
 */
export type CustomerId = number;

/**
 * The erp code for a comapny
 * @example "PPI"
 */
export type ErpCode = string;

/**
 * The facility id
 * @example "30"
 */
export type FacilityId = number;

/**
 * A unique identifier for a Quote
 * @example 37
 */
export type QuoteNumber = number;

/**
 * A unique revision number for a Quote. May be null.
 * @example 1
 */
export type RevisionNumber = number;

export interface QuoteRevisionPair {
  /** A unique identifier for a Quote */
  quote?: QuoteNumber;
  /** A unique revision number for a Quote. May be null. */
  revision_number?: RevisionNumber;
}

export type QuoteNumberArray = QuoteRevisionPair[];

export interface ManagedIntegration {
  /**
   * The name of the ERP being integrated with
   * @example "JobBOSS"
   */
  erp_name?: string;
  /**
   * whether the integration is active
   * @example true
   */
  is_active?: boolean;
  /**
   * The version of the ERP system being integrated with
   * @example "1.0"
   */
  erp_version?: string;
  /**
   * The version of the codebase processing the integration
   * @example "1.0"
   */
  integration_version?: string;
  /**
   * Whether a new integration action should be created after a new order is faciliated in Paperless
   * @example true
   */
  create_integration_action_after_creating_new_order?: boolean;
  /**
   * Whether a new integration action should be created after a new quote is sent in Paperless
   * @example true
   */
  create_integration_action_after_quote_sent?: boolean;
}

export type ManagedIntegrationDetails = ManagedIntegration & {
  /** @example 42124 */
  id?: number;
};

export interface IntegrationAction {
  /**
   * the type of action being requested
   * @example "export_order"
   */
  action_type?: string;
  /**
   * the id for action
   * @example "ff27bec2-ff2a-49b8-93fe-1a6c1b8f9f39"
   */
  action_uuid?: string;
  /**
   * The current status of the action
   * @example "in_progress"
   */
  status?: string;
  /** @example "Order 8 is currently being processed" */
  status_message?: string;
  /**
   * The identifier for the entity that should be processed as part of the action. For example, process order 8
   * @example "8"
   */
  entity_id?: string;
}

export interface PurchasedComponentProperty {
  /** Name of corresponding purchased component column in table display */
  name?: string;
  /** Name used to access property within pricing formulas via 'dot' operator */
  code_name?: string;
  value_type?: "string" | "boolean" | "numeric";
  /** Value of property, None or of type corresponding to value_type */
  value?: string | number | boolean | null;
}

export interface PurchasedComponentCustomProperty {
  /**
   * Name of corresponding purchased component column in table display
   * @example "property name"
   */
  key?: string;
  /**
   * Value of property, None or of type corresponding to value_type
   * @example "really cool value"
   */
  value?: string | number | boolean | null;
}

export interface AbstractPurchasedComponent {
  /**
   * Unique identifier for purchased component within a supplier account
   * @example "064-1235"
   */
  oem_part_number?: string;
  /** @example "a" */
  internal_part_number?: string | null;
  /** @example "any text you want" */
  description?: string | null;
  /**
   * Cost per piece to 4 decimal places
   * @format decimal
   * @example 2
   */
  piece_price?: number;
}

export type PostPurchasedComponent = AbstractPurchasedComponent & {
  properties: PurchasedComponentCustomProperty[];
};

export type PatchPurchasedComponent = AbstractPurchasedComponent & {
  properties?: PurchasedComponentCustomProperty[];
};

export type PurchasedComponent = AbstractPurchasedComponent & {
  id?: number;
  properties?: PurchasedComponentCustomProperty[];
};

export type QuotePurchasedComponent = AbstractPurchasedComponent & {
  id?: string;
  properties?: PurchasedComponentProperty[];
};

/** Expedites represent an additional option for pricing where quote recipients can request a shorter lead time, with an additional markup applied to the unit price. */
export interface QuoteExpedite {
  id?: number;
  /** Days */
  lead_time?: number;
  /**
   * Percent
   * @format float
   */
  markup?: number;
  /** @format float */
  unit_price?: number;
  /** @format float */
  total_price?: number;
}

/** A quantity object represents a unit price and a numerical quantity associated with a component. A component can have many quantities, and the set of quantities represents the pricing options available to the recipient of a quote. */
export interface QuoteQuantity {
  id?: number;
  quantity?: number;
  /**
   * Users of Paperless Parts can specify up to two distinct markup values on a component.
   * @format float
   */
  markup_1_price?: number | null;
  markup_1_name?: string | null;
  /**
   * Users of Paperless Parts can specify up to two distinct markup values on a component.
   * @format float
   */
  markup_2_price?: number | null;
  markup_2_name?: string | null;
  /** @format float */
  unit_price?: number;
  /** @format float */
  total_price?: number;
  /** @format float */
  total_price_with_required_add_ons?: number;
  /** Days */
  lead_time?: number;
  expedites?: QuoteExpedite[];
  /** Whether or not this quantity is the most likely quantity to be won. */
  is_most_likely_won_quantity?: boolean;
  most_likely_won_quantity_percent?: number;
}

export interface QuoteProcess {
  id?: number;
  name?: string;
  external_name?: string | null;
}

export interface QuoteMaterial {
  id?: number;
  name?: string;
  display_name?: string;
}

export interface QuoteAddOnQuantity {
  /** @format float */
  price?: number;
  /** @format float */
  manual_price?: number;
  quantity?: number;
}

export interface QuoteAddOn {
  is_required?: boolean;
  name?: string;
  notes?: string;
  quantities?: QuoteAddOnQuantity[];
  costing_variables?: QuoteCostingVariable[];
}

/** Represents a component in the quote item. In the simplest case, there is a single root component. If the quote item is an assembly, the array will contain each component in the assembly. Components can be manufactured (i.e., parts), assemblies (i.e., top-level or sub-assembly), or purchased (e.g., hardware). Exactly one component in the array will be the root component, but it might not be the first element in the array. */
export interface QuoteComponent {
  id?: string;
  "add-ons"?: QuoteAddOn[];
  quantities?: QuoteQuantity[];
  child_ids?: number[];
  children?: ComponentChild[];
  description?: string | null;
  /** Whether or not this component contains data that is export controlled (ITAR) by the US Government. */
  export_controlled?: boolean;
  /** Note: this field is deprecated. Finishes now show up as Operations. */
  finishes?: string[];
  /** The quantity of this subcomponent that must be produced to make one top-level component. */
  innate_quantity?: number;
  is_root_component?: boolean;
  /** This can also be null */
  material?: OrderMaterial;
  material_operations?: QuoteOperation[];
  parent_ids?: number[];
  part_name?: string;
  part_number?: string | null;
  /** @format url */
  part_url?: string;
  part_uuid?: string;
  process?: OrderProcess;
  /** Reference to a purchased component object within the supplier account. Will be not null when type == 'purchased' */
  purchased_component?: QuotePurchasedComponent | null;
  revision?: string | null;
  shop_operations?: QuoteOperation[];
  supporting_files?: OrderSupportingFile[];
  thumbnail_url?: string | null;
  type?: "assembled" | "manufactured" | "purchased";
}

/** A quote item represents a line item in a quote. Quote items can either be manual or automatic, as indicated by the 'type' property. Automatic quote items are those generated by adding a part to a quote. Pricing data for automatic quote items is automatically populated using the process, material, and operations, if they exist. Manual quote items do not have an associated part, so the pricing information must be inputted manually. */
export interface QuoteItem {
  id?: number;
  /** Indicates whether the quote item is associated with a part (automatic pricing), or not (manual pricing). */
  type?: "automatic" | "manual";
  /** ID of the root component. A root component houses the pricing information for a quote item. Every quote item has a root component. In the case of an automatic quote item, the root component corresponds to a part; in the case of a manual quote item, which does not have an associated part, the root component stores the manual pricing data. As the name 'root component' implies, it is possible for a quote item to have many components, as in the case of an assembly of nested parts. */
  root_component_id?: number;
  components?: QuoteComponent[];
  /** The position of the quote item in the quote display, indexed from 1. */
  position?: number;
  /** Whether or not this quote item contains data that is export controlled (ITAR) by the US Government. */
  export_controlled?: boolean;
  component_ids?: number[];
  private_notes?: string | null;
  public_notes?: string | null;
}

export interface QuoteContact {
  account?: {
    erp_code?: string | null;
    /** @format int */
    id?: number;
    notes?: string | null;
    name?: string;
  };
  /** @format email */
  email?: string;
  first_name?: string;
  /** @format int */
  id?: number;
  last_name?: string;
  notes?: string | null;
  phone?: string | null;
  phone_ext?: string | null;
}

/** Deprecated! Will be removed soon */
export interface QuoteCustomer {
  first_name?: string;
  last_name?: string;
  /** @format email */
  email?: string;
  notes?: string | null;
  company?: {
    notes?: string | null;
    metrics?: {
      /** @format float */
      order_revenue_all_time?: number;
      /** @format float */
      order_revenue_last_thirty_days?: number;
      quotes_sent_all_time?: number;
      quotes_sent_last_thirty_days?: number;
    };
    business_name?: string;
    erp_code?: string;
  };
}

export interface SalesPerson {
  first_name?: string;
  last_name?: string;
  /** @format email */
  email?: string;
  erp_code?: string;
}

/** Basic information about the quote this was copied from, if any. This field may be NULL. */
export interface ParentQuote {
  id?: number;
  number?: number;
  status?: string;
}

/** Basic information about the order this was copied from, if any. This field may be NULL. */
export interface ParentSupplierOrder {
  id?: number;
  number?: number;
  status?: string;
}

/** Data representing a Quote */
export interface Quote {
  /** @format url */
  authenticated_pdf_quote_url?: string | null;
  contact?: QuoteContact;
  /** @format date-time */
  created?: string;
  /** Deprecated! Will be removed soon */
  customer?: QuoteCustomer;
  /**
   * The last time the quote recipient viewed the quote
   * @format date-time
   */
  digital_last_viewed_on?: string | null;
  erp_code?: string | null;
  estimator?: SalesPerson;
  expired?: boolean;
  /** @format date-time */
  expired_date?: string;
  /** Whether or not this quote contains data that is export controlled (ITAR) by the US Government. */
  export_controlled?: boolean;
  id?: number;
  /** Quotes can be automatically generated by a supplier's RFQ form. If this quote was drafted via an RFQ and has not been viewed, this will be true. */
  is_unviewed_drafted_rfq?: boolean;
  /** A unique identifier for a Quote */
  number?: QuoteNumber;
  /** An array of Order numbers */
  order_numbers?: OrderNumberArray;
  /** Basic information about the quote this was copied from, if any. This field may be NULL. */
  parent_quote?: ParentQuote;
  /** Basic information about the order this was copied from, if any. This field may be NULL. */
  parent_supplier_order?: ParentSupplierOrder;
  private_notes?: string | null;
  quote_items?: QuoteItem[];
  quote_notes?: string | null;
  request_for_quote?: boolean | null;
  /** A unique revision number for a Quote. May be null. */
  revision_number?: RevisionNumber;
  salesperson?: SalesPerson;
  /** @format date-time */
  sent_date?: string | null;
  status?:
    | "draft"
    | "outstanding"
    | "expired"
    | "cancelled"
    | "partially_accepted"
    | "accepted"
    | "trash"
    | "lost";
  /** @format float */
  tax_cost?: number;
  /** @format float */
  tax_rate?: number;
}

/**
 * A unique identifier for an Order
 * @example 47
 */
export type OrderNumber = number;

/**
 * An array of Order numbers
 * @example [38,39,40]
 */
export type OrderNumberArray = OrderNumber[];

export type AddressInfo = {
  /** @example 55123 */
  id?: number;
  /** @example "1 City Hall Sq." */
  address1?: string;
  /** @example null */
  address2?: string | null;
  /** @example "Gordon Moore" */
  attention?: string;
  /** @example "Paperless Parts, Inc." */
  business_name?: string;
  /** @example "Boston" */
  city?: string;
  /** @example "USA" */
  country?: string;
  /** @example "Boston Office" */
  facility_name?: string | null;
  /** @example "6176354500" */
  phone?: string;
  /** @example null */
  phone_ext?: string | null;
  /** @example 2201 */
  postal_code?: string;
  /** @example "MA" */
  state?: string;
};

export type Facility = {
  /** @example 55123 */
  account_id?: number;
  address?: Address;
  /** @example "Gordon Moore" */
  attention?: string;
  /** @example 12 */
  id?: number;
  /** @example "Boston Office" */
  name?: string;
  salesperson?: SalesPerson;
} | null;

export interface OrderCompany {
  business_name?: string;
  erp_code?: string;
}

export interface OrderContact {
  account?: {
    erp_code?: string | null;
    /** @format int */
    id?: number;
    notes?: string | null;
    name?: string;
    payment_terms?: string | null;
    payment_terms_period?: string | null;
  };
  /** @format email */
  email?: string;
  first_name?: string;
  last_name?: string;
  notes?: string | null;
  phone?: string | null;
  phone_ext?: string | null;
}

/** Deprecated! Will be removed soon. */
export interface OrderCustomer {
  company?: OrderCompany;
  /** @format email */
  email?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  phone_ext?: string;
}

/** This can also be null */
export interface OrderMaterial {
  id?: number;
  display_name?: string;
  family?: string;
  material_class?: string;
  name?: string;
}

/** A CostingVariable is a piece of a Paperless Parts Programming Language (P3L) formula that determines the price and timing for an operation. CostingVariables are essentially Python variables and can represent several data types. */
export interface QuoteCostingVariable {
  label?: string;
  variable_class?: "basic" | "drop_down" | "table";
  /** Describes the type of the 'value' key in quantities property */
  value_type?: "string" | "number" | "currency" | "boolean";
  /** Flag as to whether or not this costing variable can be manipulated for each quantity break */
  quantity_specific?: boolean;
  /** The value of the costing variable for each quoted quantity. This is an object with keys corresponding to the top level quote quantities in string form e.g. '1', '5', '10'. The values for each of these keys take different shape depending on the variable_class. If variable_class=='basic', the dictionary values will take the shape {'value': 1.0}. If variable_class=='drop_down', the dictionary values will take the shape {'value': 'a', 'options': ['a', 'b']}. If variable_class=='table', the dictionary values will take the shape {'value': 'a', 'row': {'column1': 'a', 'column2': 'b'}}. So for quoted quantities 1, 5, 10 for a basic variable_class, the object will look like: {'1': {'value': 1.0}, '5': {'value': 2.0}, '10': {'value': 3.0}} */
  quantities?: {
    stringQuotedQuantity1?: {
      value?: number | string | boolean | null;
      row?: object | null;
      options?: (number | string)[] | null;
    };
    stringQuotedQuantity2?: {
      value?: number | string | boolean | null;
      row?: object | null;
      options?: (number | string)[] | null;
    };
  }[];
  /** To Be Deprecated */
  type?: string;
  /** This will be indicated by the value_type field. To Be Deprecated */
  value?: string | number | boolean | null;
  /** The row field will only be non-null when the type field is 'table'. Row represents a row in a lookup table and is an object with arbitrary keys. To Be Deprecated */
  row?: object | null;
}

/** A CostingVariable is a piece of a Paperless Parts Programming Language (P3L) formula that determines the price and timing for an operation. CostingVariables are essentially Python variables and can represent several data types. An OrderCostingVariable represents the value a variable holds for the ordered quantity. */
export interface OrderCostingVariable {
  label?: string;
  variable_class?: "basic" | "drop_down" | "table";
  value_type?: "string" | "number" | "currency" | "boolean";
  /** This will be indicated by the value_type field. */
  value?: string | number | boolean | null;
  /** An object representing a row from a custom table. This object will have arbitrary key-value pairs based on custom table schema it was pulled from. The row field will only be non-null when the variable_class field is 'table'. */
  row?: object | null;
  /** A list of the options for a drop down variable. Can be strings, floats, or integers indicated by value_type. The options field will only be non-null when the variable_class field is 'drop_down'. */
  options?: (number | string)[] | null;
  /** To Be Deprecated */
  type?: string;
}

export interface OperationQuantity {
  /** @format float */
  price?: number;
  /** @format float */
  manual_price?: number | null;
  lead_time?: number | null;
  manual_lead_time?: number | null;
  quantity?: number;
}

export interface QuoteOperation {
  id?: number;
  category?: "material" | "operation";
  /** @format float */
  cost?: number;
  costing_variables?: QuoteCostingVariable[];
  quantities?: OperationQuantity[];
  is_finish?: boolean;
  is_outside_service?: boolean;
  name?: string;
  operation_definition_name?: string;
  notes?: string | null;
  /** The position of the order operation in the order display, indexed from 1. Note that the position applies across both material operations and order operations. TODO - this shows up as 0 if there is only one operation on the order? */
  position?: number;
  /** @format float */
  runtime?: number | null;
  /** @format float */
  setup_time?: number | null;
}

export interface OrderOperation {
  id?: number;
  category?: "material" | "operation";
  /** @format float */
  cost?: number;
  costing_variables?: OrderCostingVariable[];
  quantities?: OperationQuantity[];
  is_finish?: boolean;
  is_outside_service?: boolean;
  name?: string;
  operation_definition_name?: string;
  notes?: string | null;
  /** The position of the order operation in the order display, indexed from 1. Note that the position applies across both material operations and order operations. TODO - this shows up as 0 if there is only one operation on the order? */
  position?: number;
  /** @format float */
  runtime?: number | null;
  /** @format float */
  setup_time?: number | null;
}

export interface ComponentChild {
  /** ID of the child component */
  child_id?: number;
  /** The number of child component instances belonging to this parent. Note, the total number of instances of this child component in this assembly tree may be larger if this child appears in multiple places in the tree. */
  quantity?: number;
}

export interface OrderProcess {
  id?: number;
  external_name?: string;
  name?: string;
}

export interface OrderSupportingFile {
  filename?: string;
  /** @format url */
  url?: string;
}

export interface OrderComponent {
  id?: string;
  child_ids?: number[];
  children?: ComponentChild[];
  /** The quantity of this component that must be delivered (innate quantity * root component quantity). */
  deliver_quantity?: number;
  description?: string | null;
  /** Whether or not this order component contains data that is export controlled (ITAR) by the US Government. */
  export_controlled?: boolean;
  /** Note: this field is deprecated. Finishes now show up as Operations. */
  finishes?: string[];
  /** The quantity of this subcomponent that must be produced to make one top-level component. */
  innate_quantity?: number;
  is_root_component?: boolean;
  /** The quantity of this component that must be made to satisfy the quantity specified by the customer as well as the yield specified for this component (innate quantity * root component quantity / yield). */
  make_quantity?: number;
  /** This can also be null */
  material?: OrderMaterial;
  material_operations?: OrderOperation[];
  parent_ids?: number[];
  part_name?: string;
  part_number?: string | null;
  /** @format url */
  part_url?: string;
  part_uuid?: string;
  process?: OrderProcess;
  /** Reference to a purchased component object within the supplier account. Will be not null when type == 'purchased' */
  purchased_component?: QuotePurchasedComponent | null;
  revision?: string | null;
  shop_operations?: OrderOperation[];
  supporting_files?: OrderSupportingFile[];
  thumbnail_url?: string | null;
  type?: "assembled" | "manufactured" | "purchased";
}

export interface OrderAddOn {
  is_required?: boolean;
  name?: string;
  notes?: string;
  /** @format float */
  price?: number;
  quantity?: number;
  costing_variables?: OrderCostingVariable[];
}

export interface OrderItem {
  id?: number;
  components?: OrderComponent[];
  description?: string | null;
  /** @format float */
  expedite_revenue?: number | null;
  /** Whether or not this order item contains data that is export controlled (ITAR) by the US Government. */
  export_controlled?: boolean;
  filename?: string;
  lead_days?: number;
  /** @format float */
  markup_1_price?: number;
  markup_1_name?: string;
  /** @format float */
  markup_2_price?: number;
  markup_2_name?: string;
  private_notes?: string | null;
  public_notes?: string | null;
  quantity?: number;
  quantity_outstanding?: number;
  quote_item_id?: number;
  /** Indicates whether the quote item is associated with a part (automatic pricing), or not (manual pricing). */
  quote_item_type?: "automatic" | "manual";
  root_component_id?: number;
  /** @format date */
  ships_on?: string;
  /** @format float */
  total_price?: number;
  /** @format float */
  unit_price?: number;
  /** @format float */
  base_price?: number;
  /** @format float */
  add_on_fees?: number | null;
  ordered_add_ons?: OrderAddOn[];
}

export interface OrderPaymentDetails {
  card_brand?: string | null;
  card_last4?: string | null;
  /** @format float */
  net_payout?: number | null;
  payment_type?: "credit_card" | "purchase_order" | null;
  purchase_order_number?: string;
  /** @format email */
  purchasing_dept_contact_email?: string | null;
  purchasing_dept_contact_name?: string | null;
  /** @format float */
  shipping_cost?: number;
  /** @format float */
  subtotal?: number;
  /** @format float */
  tax_cost?: number;
  /** @format float */
  tax_rate?: number;
  payment_terms?: string | null;
  /** @format float */
  total_price?: number;
}

export interface OrderShipmentItem {
  id?: number;
  order_item_id?: number;
  quantity?: number;
}

export interface OrderShipment {
  id?: number;
  pickup_recipient?: string | null;
  /** @format date-time */
  shipment_date?: string;
  shipment_items?: OrderShipmentItem[];
  /** @format float */
  shipping_cost?: number;
  tracking_number?: string;
}

export interface OrderShippingOption {
  customers_account_number?: string | null;
  customers_carrier?: "ups" | "fedex" | null;
  shipping_method?:
    | "early_am_overnight"
    | "ground"
    | "next_day_air"
    | "second_day_air"
    | null;
  type?: "pickup" | "customers_shipping_account" | "suppliers_shipping_account";
}

export interface Order {
  billing_info?: AddressInfo;
  /** @format date-time */
  created?: string;
  contact?: OrderContact;
  /** Deprecated! Will be removed soon. */
  customer?: OrderCustomer;
  /** @format date-time */
  deliver_by?: string | null;
  erp_code?: string | null;
  estimator?: SalesPerson;
  /** A unique identifier for an Order */
  number?: OrderNumber;
  order_items?: OrderItem[];
  payment_details?: OrderPaymentDetails;
  private_notes?: string | null;
  quote_erp_code?: string | null;
  quote_number?: number;
  quote_revision_number?: number;
  salesperson?: SalesPerson;
  shipments?: OrderShipment[];
  shipping_info?: AddressInfo;
  shipping_option?: OrderShippingOption;
  /** @format date */
  ships_on?: string;
  status?:
    | "pending"
    | "confirmed"
    | "on_hold"
    | "in_process"
    | "completed"
    | "cancelled";
}

/**
 * Data representing a Quote that will be used to generate an Order. This endpoint provides an alternative to the checkout flow in the app. For each quote item you'd like to check out for, specify the quantity and unit price. Note that you may submit an arbitrary quantity and arbitrary unit price; you are not restricted to the options on the quote.
 *
 *  NOTE: shipping_info, billing_info and shipping_option are optional.
 */
export interface FacilitateOrderBody {
  number?: number;
  quantity_data?: {
    quote_item_id?: number;
    quantity?: number;
    /** @format float */
    unit_price?: number;
    /** If you'd like to apply add-ons, specify the ID of the AddOn you'd like to apply (not the ID of the AddOnQuantity). If you've selected an existing quantity and unit price for this quote item, the corresponding existing AddOnQuantity will be used. If you've specified a nonexistent quantity and/or unit price, a new AddOnQuantity will be created with the supplied manual_price. */
    add_ons?: {
      add_on_id?: number;
      /**
       * There is no need to supply this field if you have selected an existing quantity and unit_price for this quote item.
       * @format float
       */
      manual_price?: number | null;
    }[];
    expedite_id?: number | null;
  }[];
  shipping_info?: {
    business_name?: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
    phone_ext?: string;
    address?: {
      address1?: string;
      address2?: string;
      postal_code?: string;
      city?: string;
      state?: {
        abbr?: string;
      };
      country?: {
        abbr?: string;
      };
    };
  } | null;
  billing_info?: {
    business_name?: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
    phone_ext?: string;
    address?: {
      address1?: string;
      address2?: string;
      postal_code?: string;
      city?: string;
      state?: {
        abbr?: string;
      };
      country?: {
        abbr?: string;
      };
    };
  } | null;
  shipping_option?: {
    type?:
      | "pickup"
      | "customers_shipping_account"
      | "suppliers_shipping_account";
    shipping_method?:
      | "early_am_overnight"
      | "next_day_air"
      | "second_day_air"
      | "ground";
    ship_when?: "when_ready" | "all_at_once";
  } | null;
}

export interface Contact {
  address?: Address;
  /**
   * The ID of the associated account
   * @example 17
   */
  account_id?: number | null;
  /** @example "2020-08-25T18:00:53+00:00" */
  created?: string;
  /**
   * (Required) email address (must be non-null, unique across all Customers, and a valid email format)
   * @example "careers@paperlessparts.com"
   */
  email?: string;
  /**
   * (Required) Customer first name (must be non-null)
   * @example "Gordon"
   */
  first_name?: string;
  /** @example 137 */
  id?: number;
  /**
   * (Required) Customer last name (must be non-null)
   * @example "Moore"
   */
  last_name?: string;
  /** Customer notes */
  notes?: string | null;
  /**
   * Customer phone number
   * @example "6176354500"
   */
  phone?: string | null;
  /**
   * Customer phone number extension
   * @example null
   */
  phone_ext?: string | null;
  salesperson?: SalesPerson;
}

export interface Account {
  billing_address?: Address[];
  /**
   * (Required) The name of the account
   * @example "Paperless Parts, Inc."
   */
  name?: string;
  /** @example "2020-08-25T18:00:53+00:00" */
  created?: string;
  /**
   * credit line (dollars)
   * @example 10000
   */
  credit_line?: number | null;
  /**
   * The ERP code of the account
   * @example "PPI"
   */
  erp_code?: string | null;
  /**
   * the ID of the account
   * @example 17
   */
  id?: number;
  /** Account notes */
  notes?: string | null;
  /**
   * Payment terms; required if `payment_terms_period` are included
   * @example "Net 30"
   */
  payment_terms?: string | null;
  /**
   * Payment terms period in days; required if `payment_terms` are included, but can be `null`
   * @example 30
   */
  payment_terms_period?: number | null;
  /**
   * Account phone number
   * @example "6176354500"
   */
  phone?: string | null;
  /**
   * Account phone number extension
   * @example null
   */
  phone_ext?: string | null;
  /**
   * When `true` this account can check out with a purchase order
   * @example true
   */
  purchase_orders_enabled?: boolean;
  salesperson?: SalesPerson;
  sold_to_address?: Address;
  /**
   * When `true`, sales tax will not be added to a quote
   * @example true
   */
  tax_exempt?: boolean;
  /**
   * Sales tax rate for this account
   * @example 6.25
   */
  tax_rate?: number | null;
  /**
   * Type of account, either customer or vendor
   * @example "customer"
   */
  type?: string;
  /** @example "https://www.paperlessparts.com" */
  url?: string | null;
}

export interface Address {
  /**
   * (Required)
   * @maxLength 250
   * @example "1 City Hall Sq."
   */
  address1?: string;
  /**
   * (Required)
   * @maxLength 250
   * @example null
   */
  address2?: string | null;
  /**
   * (Required)
   * @maxLength 100
   * @example "Boston"
   */
  city?: string;
  /**
   * (Required) State/Province must be specified as standard postal abbreviation
   * @example "MA"
   */
  state?: string;
  /**
   * (Required) US postal codes may optionally contain 4-digit extension, e.g., `'02114-1234'`
   * @example "02114"
   */
  postal_code?: string;
  /**
   * (Required) Country must be ISO 3166-1 alpha-3 code. Currently allowed values are `'USA'`, `'CAN'`.
   * @maxLength 3
   * @example "USA"
   */
  country?: string;
  /**
   * The unique identifier for this address record in the ERP
   * @maxLength 50
   * @example "B1234"
   */
  erp_code?: string;
}

export interface AddressBody {
  /**
   * @maxLength 100
   * @example "Gordon"
   */
  first_name?: string | null;
  /**
   * @maxLength 100
   * @example "Moore"
   */
  last_name?: string | null;
  /**
   * @maxLength 10
   * @example "6176354500"
   */
  phone?: string | null;
  /**
   * @maxLength 10
   * @example null
   */
  phone_ext?: string | null;
  /**
   * @maxLength 100
   * @example "Paperless Parts Inc."
   */
  business_name?: string | null;
  /**
   * (Required)
   * @maxLength 250
   * @example "1 City Hall Sq."
   */
  address1?: string;
  /**
   * (Required)
   * @maxLength 250
   * @example null
   */
  address2?: string | null;
  /**
   * (Required)
   * @maxLength 100
   * @example "Boston"
   */
  city?: string;
  /**
   * (Required) State/Province must be specified as standard postal abbreviation
   * @example "MA"
   */
  state?: string;
  /**
   * (Required) US postal codes may optionally contain 4-digit extension, e.g., `'02114-1234'`
   * @example "02114"
   */
  postal_code?: string;
  /**
   * (Required) Country must be ISO 3166-1 alpha-3 code. Currently allowed values are `'USA'`, `'CAN'`.
   * @maxLength 3
   * @example "USA"
   */
  country?: string;
}

export type CustomTableListResults = string[];

export interface CustomTableName {
  name?: string;
}

export interface CustomTableRelatedEntity {
  entity_type?: "operation" | "process";
  name?: string;
}

export interface CustomTableColumnConfig {
  column_name?: string;
  value_type?: "numeric" | "string" | "boolean";
}

/** The keys in this object must match the column names in the config property above, and the corresponding values must be castable to the specified types in the config property. */
export type CustomTableRowData = object;

export interface CustomTableDetails {
  columns?: string[];
  name?: string;
  related_entities?: CustomTableRelatedEntity[];
  rows?: object[];
}

export interface CustomTableBody {
  name?: string | null;
  config?: CustomTableColumnConfig[] | null;
  data?: CustomTableRowData[] | null;
}

export type PurchasedComponentsColumnId = number;

export type PurchasedComponentId = number;

export interface AbstractPurchasedComponentsColumn {
  /** @example "James_Bond" */
  code_name?: string;
  /** @example "James Bond" */
  name?: string;
  /** @example "numeric" */
  value_type?: string;
  /** @example 21 */
  default_numeric_value?: number | null;
  /** @example null */
  default_string_value?: string | null;
  /** @example false */
  default_boolean_value?: boolean;
}

export type PostPurchasedComponentsColumn = AbstractPurchasedComponentsColumn &
  object;

export type PatchPurchasedComponentsColumn =
  AbstractPurchasedComponentsColumn & {
    update_existing_defaults?: boolean;
    /** @example 4 */
    position?: number;
  };

export type PurchasedComponentsColumn = AbstractPurchasedComponentsColumn & {
  /** @example 25 */
  id?: number;
  /**
   * Position of the column when displayed in the table; starts at 1.
   * @example 4
   */
  position?: number;
};

export type QueryParamsType = Record<string | number, any>;
export type ResponseFormat = keyof Omit<Body, "body" | "bodyUsed">;

export interface FullRequestParams extends Omit<RequestInit, "body"> {
  /** set parameter to `true` for call `securityWorker` for this request */
  secure?: boolean;
  /** request path */
  path: string;
  /** content type of request body */
  type?: ContentType;
  /** query params */
  query?: QueryParamsType;
  /** format of response (i.e. response.json() -> format: "json") */
  format?: ResponseFormat;
  /** request body */
  body?: unknown;
  /** base url */
  baseUrl?: string;
  /** request cancellation token */
  cancelToken?: CancelToken;
}

export type RequestParams = Omit<
  FullRequestParams,
  "body" | "method" | "query" | "path"
>;

export interface ApiConfig<SecurityDataType = unknown> {
  baseUrl?: string;
  baseApiParams?: Omit<RequestParams, "baseUrl" | "cancelToken" | "signal">;
  securityWorker?: (
    securityData: SecurityDataType | null
  ) => Promise<RequestParams | void> | RequestParams | void;
  customFetch?: typeof fetch;
}

export interface HttpResponse<D extends unknown, E extends unknown = unknown>
  extends Response {
  data: D;
  error: E;
}

type CancelToken = Symbol | string | number;

export enum ContentType {
  Json = "application/json",
  FormData = "multipart/form-data",
  UrlEncoded = "application/x-www-form-urlencoded",
  Text = "text/plain",
}

export class HttpClient<SecurityDataType = unknown> {
  public baseUrl: string = "https://api.paperlessparts.com/";
  private securityData: SecurityDataType | null = null;
  private securityWorker?: ApiConfig<SecurityDataType>["securityWorker"];
  private abortControllers = new Map<CancelToken, AbortController>();
  private customFetch = (...fetchParams: Parameters<typeof fetch>) =>
    fetch(...fetchParams);

  private baseApiParams: RequestParams = {
    credentials: "same-origin",
    headers: {},
    redirect: "follow",
    referrerPolicy: "no-referrer",
  };

  constructor(apiConfig: ApiConfig<SecurityDataType> = {}) {
    Object.assign(this, apiConfig);
  }

  public setSecurityData = (data: SecurityDataType | null) => {
    this.securityData = data;
  };

  protected encodeQueryParam(key: string, value: any) {
    const encodedKey = encodeURIComponent(key);
    return `${encodedKey}=${encodeURIComponent(
      typeof value === "number" ? value : `${value}`
    )}`;
  }

  protected addQueryParam(query: QueryParamsType, key: string) {
    return this.encodeQueryParam(key, query[key]);
  }

  protected addArrayQueryParam(query: QueryParamsType, key: string) {
    const value = query[key];
    return value.map((v: any) => this.encodeQueryParam(key, v)).join("&");
  }

  protected toQueryString(rawQuery?: QueryParamsType): string {
    const query = rawQuery || {};
    const keys = Object.keys(query).filter(
      (key) => "undefined" !== typeof query[key]
    );
    return keys
      .map((key) =>
        Array.isArray(query[key])
          ? this.addArrayQueryParam(query, key)
          : this.addQueryParam(query, key)
      )
      .join("&");
  }

  protected addQueryParams(rawQuery?: QueryParamsType): string {
    const queryString = this.toQueryString(rawQuery);
    return queryString ? `?${queryString}` : "";
  }

  private contentFormatters: Record<ContentType, (input: any) => any> = {
    [ContentType.Json]: (input: any) =>
      input !== null && (typeof input === "object" || typeof input === "string")
        ? JSON.stringify(input)
        : input,
    [ContentType.Text]: (input: any) =>
      input !== null && typeof input !== "string"
        ? JSON.stringify(input)
        : input,
    [ContentType.FormData]: (input: any) =>
      Object.keys(input || {}).reduce((formData, key) => {
        const property = input[key];
        formData.append(
          key,
          property instanceof Blob
            ? property
            : typeof property === "object" && property !== null
            ? JSON.stringify(property)
            : `${property}`
        );
        return formData;
      }, new FormData()),
    [ContentType.UrlEncoded]: (input: any) => this.toQueryString(input),
  };

  protected mergeRequestParams(
    params1: RequestParams,
    params2?: RequestParams
  ): RequestParams {
    return {
      ...this.baseApiParams,
      ...params1,
      ...(params2 || {}),
      headers: {
        ...(this.baseApiParams.headers || {}),
        ...(params1.headers || {}),
        ...((params2 && params2.headers) || {}),
      },
    };
  }

  protected createAbortSignal = (
    cancelToken: CancelToken
  ): AbortSignal | undefined => {
    if (this.abortControllers.has(cancelToken)) {
      const abortController = this.abortControllers.get(cancelToken);
      if (abortController) {
        return abortController.signal;
      }
      return void 0;
    }

    const abortController = new AbortController();
    this.abortControllers.set(cancelToken, abortController);
    return abortController.signal;
  };

  public abortRequest = (cancelToken: CancelToken) => {
    const abortController = this.abortControllers.get(cancelToken);

    if (abortController) {
      abortController.abort();
      this.abortControllers.delete(cancelToken);
    }
  };

  public request = async <T = any, E = any>({
    body,
    secure,
    path,
    type,
    query,
    format,
    baseUrl,
    cancelToken,
    ...params
  }: FullRequestParams): Promise<HttpResponse<T, E>> => {
    const secureParams =
      ((typeof secure === "boolean" ? secure : this.baseApiParams.secure) &&
        this.securityWorker &&
        (await this.securityWorker(this.securityData))) ||
      {};
    const requestParams = this.mergeRequestParams(params, secureParams);
    const queryString = query && this.toQueryString(query);
    const payloadFormatter = this.contentFormatters[type || ContentType.Json];
    const responseFormat = format || requestParams.format;

    return this.customFetch(
      `${baseUrl || this.baseUrl || ""}${path}${
        queryString ? `?${queryString}` : ""
      }`,
      {
        ...requestParams,
        headers: {
          ...(requestParams.headers || {}),
          ...(type && type !== ContentType.FormData
            ? { "Content-Type": type }
            : {}),
        },
        signal:
          (cancelToken
            ? this.createAbortSignal(cancelToken)
            : requestParams.signal) || null,
        body:
          typeof body === "undefined" || body === null
            ? null
            : payloadFormatter(body),
      }
    ).then(async (response) => {
      const r = response.clone() as HttpResponse<T, E>;
      r.data = null as unknown as T;
      r.error = null as unknown as E;

      const data = !responseFormat
        ? r
        : await response[responseFormat]()
            .then((data) => {
              if (r.ok) {
                r.data = data;
              } else {
                r.error = data;
              }
              return r;
            })
            .catch((e) => {
              r.error = e;
              return r;
            });

      if (cancelToken) {
        this.abortControllers.delete(cancelToken);
      }

      if (!response.ok) throw data;
      return data;
    });
  };
}

/**
 * @title Paperless Parts API
 * @version 1.0
 * @termsOfService https://www.paperlessparts.com/web-service-agreement/
 * @baseUrl https://api.paperlessparts.com/
 * @contact Paperless Parts <support@paperlessparts.com> (https://www.paperlessparts.com)
 *
 *  The Paperless Parts API provides access to your data, enabling developers to easily integrate Paperless Parts with third-party systems, such as Customer Relationship Management (CRM) and Enterprise Resource Planning (ERP) tools. The API is designed to support two primary use case. First, reading all information associated with a particular order or quote for import into another system. Second, managing customer data, either for an initial bulk import or for on-going synchronization with an external database.
 * ## Authorization ##
 * Requests are authorized via an API key. Administrators of a Paperless Parts account can generate an API Token which grants access to all of the endpoints documented here. The token obtained from the application must be added to the header of all requests using the key `"Authorization"` with the value `"API-Token <api_token>"`, where `<api_token>` is your Paperless Parts API Token.
 *
 * You can use the "Execute" button in an endpoint's documentation on this page to try out the endpoint. This will send a request to the endpoint on the Paperless Parts server and display the result on this page. Before doing so, however, you'll need to click on the 'Authorize' button at the top of the screen, and in the "Value" field enter `"API-Token <api_token>"`, where `<api_token>` is your API token as described above.
 *
 * ## Overview ##
 * The API endpoints are organized around REST. API calls should be made to the `https://api.paperlessparts.com` base domain. URLs are designed to clearly describe an entity or collection of entities. HTTP verbs typically describe whether entities are being read, created, modified, or deleted. Where applicable, request and response bodies are in JSON format. Standard HTTP response codes, in addition to error messages, are used to help explain request failures.
 * ### Associations
 * Many entities in the API data model are associated with other entities. As a guiding principle, `GET` requests that fetch data nest associated entities in the JSON response. However, when creating or modifying entities, a flat (non-nested) object must be provided, as explained in the documentation for each endpoint. Associations are specified when writing data by using entity IDs in fields ending in `_id`.
 *
 * For example, consider the relationship where a Company has many Customers. When fetching a Customer via a `GET` request, the associated Company will be nested as an object with key `company` in the response. When creating a Customer, the Company is specified via its integer id using the key `company_id`.
 * ### HTTP Methods
 * The API endpoints support different HTTP methods depending on whether records are being read, created, or updated. To read an entity, use `GET`. To create a new entity, use `POST`. To modifying an entity, use `PATCH`. Note, `PATCH` is used rather than `PUT` to indicate that entities can be partially updated. In other words, in general, if a field is omitted from a `PATCH` request, that field's value will stay the same (rather than be set to `null`). All fields requiring values are required to be included in `POST` requests.
 * > Note: Endpoints with a documented `PATCH` method can generally be used with a `PUT` method. The `PUT` is implemented as a partial update (as opposed to a replacement) and is supported for maximum compatibilty.
 *
 * For example, consider the `email` field on the Customer entity, which is required. All Customers must have a non-null `email`. When creating a Customer via `POST`, the request body must contain an `email` key and its value cannot be `null` (other validation applies to that field, as well, including a valid email format and a unique value). When editing a Customer via `PATCH` request, it is not necessary to include an `email` key in the request body. If `email` is omitted, the existing email address will not be changed. If you send a `PATCH` request with `email=null`, then you will receive an error response indicating that a value for `email` is required.
 */
export class PaperlessPartsClient<
  SecurityDataType extends unknown
> extends HttpClient<SecurityDataType> {
  constructor(apiKey: string, apiConfig: ApiConfig<SecurityDataType> = {}) {
    const baseApiParams = {
      ...apiConfig.baseApiParams,
      headers: {
        ...apiConfig.baseApiParams?.headers,
        Authorization: `API-Token ${apiKey}`,
      },
    };

    super({ ...apiConfig, baseApiParams });
  }

  quotes = {
    /**
     * @description List the numbers and revisions of new quotes that have been sent. If the number and (optional) revision of the last known sent quote is supplied, this endpoint will return a list of the numbers and revisions of the quotes sent after the specified quote. If no number is provided, this endpoint will return a list of the numbers and revisions of all sent quotes. Note that the quote numbers will be returned in the order the quotes were sent, not necessarily in ascending numerical order.
     *
     * @tags Quotes
     * @name NewQuoteNumbers
     * @summary List new quote numbers and revisions
     * @request GET:/quotes/public/new
     * @secure
     */
    newQuoteNumbers: (
      query?: {
        /** **Last known sent quote number**. You may supply the number of the last known quote. */
        last_quote?: QuoteNumber;
        /** **Last known sent quote revision number**. You may supply the revision number of the last known quote. */
        revision?: RevisionNumber;
      },
      params: RequestParams = {}
    ) =>
      this.request<QuoteNumberArray, AccountLocator>({
        path: `/quotes/public/new`,
        method: "GET",
        query: query,
        secure: true,
        format: "json",
        ...params,
      }),

    /**
     * @description Get the details for a specific quote.
     *
     * @tags Quotes
     * @name QuoteDetails
     * @summary Get quote details
     * @request GET:/quotes/public/{quoteNumber}
     * @secure
     */
    quoteDetails: (
      quoteNumber: QuoteNumber,
      query?: {
        /** The (optional) quote revision number */
        revision?: RevisionNumber;
      },
      params: RequestParams = {}
    ) =>
      this.request<Quote, AccountLocator>({
        path: `/quotes/public/${quoteNumber}`,
        method: "GET",
        query: query,
        secure: true,
        format: "json",
        ...params,
      }),

    /**
     * @description Update fields on a Quote.
     *
     * @tags Quotes
     * @name UpdateQuote
     * @summary Update fields on a Quote
     * @request PATCH:/quotes/public/{quoteNumber}
     * @secure
     */
    updateQuote: (
      quoteNumber: QuoteNumber,
      data: {
        /**
         * The unique identifier of the corresponding quote record in the ERP system, cast to a string.
         * @example "1234"
         */
        erp_code?: string | null;
      },
      query?: {
        /** The (optional) quote revision number */
        revision?: RevisionNumber;
      },
      params: RequestParams = {}
    ) =>
      this.request<Quote, any>({
        path: `/quotes/public/${quoteNumber}`,
        method: "PATCH",
        query: query,
        body: data,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description Update a specific quote's status.
     *
     * @tags Quotes
     * @name SetQuoteStatus
     * @summary Update a quote's status
     * @request PATCH:/quotes/public/{quoteNumber}/status_change
     * @secure
     */
    setQuoteStatus: (
      quoteNumber: QuoteNumber,
      data: {
        /**
         * the status of the quote. Available statuses are "oustanding", "cancelled", "lost", and "trash"
         * @example "outstanding"
         */
        status?: string | null;
      },
      query?: {
        /** The (optional) quote revision number */
        revision?: RevisionNumber;
      },
      params: RequestParams = {}
    ) =>
      this.request<Quote, any>({
        path: `/quotes/public/${quoteNumber}/status_change`,
        method: "PATCH",
        query: query,
        body: data,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),
  };
  orders = {
    /**
     * @description List the numbers of new orders that have been created. If the number of the last known order is supplied, this endpoint will return a list of the numbers of the orders created after the specified order. If no number is provided, this endpoint will return a list of all available order numbers.
     *
     * @tags Orders
     * @name NewOrderNumbers
     * @summary List new order numbers
     * @request GET:/orders/public/new
     * @secure
     */
    newOrderNumbers: (
      query?: {
        /** **Last known order number**. You may supply the number of the last known order. */
        last_order?: OrderNumber;
      },
      params: RequestParams = {}
    ) =>
      this.request<OrderNumberArray, AccountLocator>({
        path: `/orders/public/new`,
        method: "GET",
        query: query,
        secure: true,
        format: "json",
        ...params,
      }),

    /**
     * @description Get the details for a specific order.
     *
     * @tags Orders
     * @name OrderDetails
     * @summary Get order details
     * @request GET:/orders/public/{orderNumber}
     * @secure
     */
    orderDetails: (orderNumber: OrderNumber, params: RequestParams = {}) =>
      this.request<Order, AccountLocator>({
        path: `/orders/public/${orderNumber}`,
        method: "GET",
        secure: true,
        format: "json",
        ...params,
      }),

    /**
     * @description Update fields on an Order.
     *
     * @tags Orders
     * @name UpdateOrder
     * @summary Update fields on an Order
     * @request PATCH:/orders/public/{orderNumber}
     * @secure
     */
    updateOrder: (
      orderNumber: OrderNumber,
      data: {
        /**
         * The unique identifier of the corresponding order record in the ERP system, cast to a string.
         * @example "1234"
         */
        erp_code?: string | null;
      },
      params: RequestParams = {}
    ) =>
      this.request<Order, any>({
        path: `/orders/public/${orderNumber}`,
        method: "PATCH",
        body: data,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Orders
     * @name PublicFacilitateOrderCreate
     * @summary Create an order from a quote
     * @request POST:/orders/public/facilitate_order
     * @secure
     */
    publicFacilitateOrderCreate: (
      data: FacilitateOrderBody,
      params: RequestParams = {}
    ) =>
      this.request<void, void>({
        path: `/orders/public/facilitate_order`,
        method: "POST",
        body: data,
        secure: true,
        type: ContentType.Json,
        ...params,
      }),
  };
  contacts = {
    /**
     * @description Returns a list of contacts. The contacts are returned 20 results at a time and can be iterated over by using the page parameter.
     *
     * @tags Customers
     * @name ListContacts
     * @summary List contacts
     * @request GET:/contacts/public
     * @secure
     */
    listContacts: (
      query?: {
        /** Value used to search against the following fields: email, first name, last name, notes, phone, and account_id. Comparisons are not case sensitive and will match when the field value includes the search value as a substring. */
        search?: string;
        /** The page of results to return. */
        page?: string;
        /**
         * The id of the account who's contacts to return. Must be an exact match.
         * @example "17'"
         */
        account_id?: number;
      },
      params: RequestParams = {}
    ) =>
      this.request<
        {
          /**
           * the ID of the associated Account
           * @example 17
           */
          account_id?: number | null;
          /** @example "2020-08-25T18:00:53+00:00" */
          created?: string;
          /**
           * email address (must be non-null, unique across all Contacts, and a valid email format)
           * @example "careers@paperlessparts.com"
           */
          email?: string;
          /**
           * Contact first name (must be non-null)
           * @example "Gordon"
           */
          first_name?: string;
          /** @example 137 */
          id?: number;
          /**
           * Contact last name (must be non-null)
           * @example "Moore"
           */
          last_name?: string;
          /**
           * Contact phone number
           * @example "6176354500"
           */
          phone?: string | null;
          /**
           * Contact phone number extension
           * @example null
           */
          phone_ext?: string | null;
        }[],
        AccountLocator
      >({
        path: `/contacts/public`,
        method: "GET",
        query: query,
        secure: true,
        format: "json",
        ...params,
      }),

    /**
     * @description Creates a new contact.
     *
     * @tags Customers
     * @name CreateContact
     * @summary Create new contact
     * @request POST:/contacts/public
     * @secure
     */
    createContact: (
      data: {
        /**
         * the ID of the associated Account
         * @example 137
         */
        account_id?: number | null;
        /** the contact's address */
        address?: {
          /**
           * The street address
           * @example "137 Portland St."
           */
          address1?: string;
          /**
           * Unit
           * @example "Unit 1"
           */
          address2?: string | null;
          /**
           * The city of the address
           * @example "Boston"
           */
          city?: string;
          /**
           * The three character country abbreviation
           * @example "USA"
           */
          country?: string;
          /**
           * The postal code for the address
           * @example "02114"
           */
          postal_code?: string;
          /**
           * The two character state abbreviation
           * @example "MA"
           */
          state?: string;
        };
        /**
         * email address (must be non-null, unique across all Contacts, and a valid email format)
         * @example "careers@paperlessparts.com"
         */
        email?: string;
        /**
         * Contact first name (must be non-null)
         * @example "Gordon"
         */
        first_name?: string;
        /**
         * Contact last name (must be non-null)
         * @example "Moore"
         */
        last_name?: string;
        /** Contact notes */
        notes?: string | null;
        /**
         * Customer phone number
         * @example "6176354500"
         */
        phone?: string | null;
        /**
         * Customer phone number extension
         * @example null
         */
        phone_ext?: string | null;
        /** the contacts salesperson */
        salesperson?: {
          /**
           * The salespersons email address. Must correspond to an active team member in your Paperless Parts account.
           * @example "careers@paperlessparts.com"
           */
          email?: string;
        } | null;
      },
      params: RequestParams = {}
    ) =>
      this.request<Contact, any>({
        path: `/contacts/public`,
        method: "POST",
        body: data,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description Get all Contact attributes
     *
     * @tags Customers
     * @name ContactDetails
     * @summary Get details about a Contact
     * @request GET:/contacts/public/{contactId}
     * @secure
     */
    contactDetails: (contactId: CustomerId, params: RequestParams = {}) =>
      this.request<Contact, any>({
        path: `/contacts/public/${contactId}`,
        method: "GET",
        secure: true,
        format: "json",
        ...params,
      }),

    /**
     * @description Partially update Contact attributes (not including associated entities)
     *
     * @tags Customers
     * @name UpdateCustomer
     * @summary Update a Contact
     * @request PATCH:/contacts/public/{contactId}
     * @secure
     */
    updateCustomer: (
      contactId: CustomerId,
      data: {
        /**
         * the ID of the associated Account
         * @example 137
         */
        account_id?: number | null;
        /** The contact's address. If an address exists on a customer then individual fields can be patched, otherwise all fields are required */
        address?: {
          /**
           * The street address
           * @example "137 Portland St."
           */
          address1?: string;
          /**
           * Unit
           * @example "Unit 1"
           */
          address2?: string | null;
          /**
           * The city of the address
           * @example "Boston"
           */
          city?: string;
          /**
           * The three character country abbreviation
           * @example "USA"
           */
          country?: string;
          /**
           * The postal code for the address
           * @example "02114"
           */
          postal_code?: string;
          /**
           * The two character state abbreviation
           * @example "MA"
           */
          state?: string;
        };
        /**
         * email address (must be non-null, unique across all Contacts, and a valid email format)
         * @example "careers@paperlessparts.com"
         */
        email?: string;
        /**
         * Contact first name (must be non-null)
         * @example "Gordon"
         */
        first_name?: string;
        /**
         * Contact last name (must be non-null)
         * @example "Moore"
         */
        last_name?: string;
        /** Contact notes */
        notes?: string | null;
        /**
         * Customer phone number
         * @example "6176354500"
         */
        phone?: string | null;
        /**
         * Customer phone number extension
         * @example null
         */
        phone_ext?: string | null;
        /** the contacts salesperson */
        salesperson?: {
          /**
           * The salespersons email address. Must correspond to an active team member in your Paperless Parts account.
           * @example "careers@paperlessparts.com"
           */
          email?: string;
        } | null;
      },
      params: RequestParams = {}
    ) =>
      this.request<Contact, any>({
        path: `/contacts/public/${contactId}`,
        method: "PATCH",
        body: data,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),
  };
  accounts = {
    /**
     * @description Returns a list of accounts. The accounts are returned 20 results at a time and can be iterated over by using the page parameter.
     *
     * @tags Customers
     * @name ListAccounts
     * @summary List accounts
     * @request GET:/accounts/public
     * @secure
     */
    listAccounts: (
      query?: {
        /** Value used to search against the following fields: account name, erp code, notes, and id. Comparisons are not case sensitive and will match when the field value includes the search value as a substring. */
        search?: string;
        /** The page of results to return. */
        page?: string;
        /**
         * The erp code of the accounts to return. Must be an exact match.
         * @example "PPI"
         */
        erp_code?: string;
        /**
         * Filters for accounts whose erp code is either null or an empty string.
         * @example true
         */
        null_erp_code?: boolean;
      },
      params: RequestParams = {}
    ) =>
      this.request<
        {
          /**
           * The name of the account
           * @example "Paperless Parts, Inc."
           */
          name?: string;
          /**
           * The ERP code of the account
           * @example "PPI"
           */
          erp_code?: string;
          /**
           * the ID of the account
           * @example 17
           */
          id?: number;
          /**
           * Account phone number
           * @example "6176354500"
           */
          phone?: string;
          /**
           * Account phone number extension
           * @example null
           */
          phone_ext?: string;
          /**
           * Account type, either customer or vendor
           * @example "customer"
           */
          type?: string;
        }[],
        AccountLocator
      >({
        path: `/accounts/public`,
        method: "GET",
        query: query,
        secure: true,
        format: "json",
        ...params,
      }),

    /**
     * @description Creates a new account.
     *
     * @tags Customers
     * @name CreateAccoumt
     * @summary Create new Account
     * @request POST:/accounts/public
     * @secure
     */
    createAccoumt: (
      data: {
        /**
         * (Required) Account Name (must be non-null and non-blank)
         * @example "Paperless Parts, Inc."
         */
        name?: string;
        /**
         * An account's credit line
         * @example 10000
         */
        credit_line?: number | null;
        /**
         * Erp code for the account
         * @example "PPI"
         */
        erp_code?: string | null;
        /** Account notes */
        notes?: string | null;
        /**
         * Payment terms; required if `payment_terms_period` are included
         * @example "Net 30"
         */
        payment_terms?: string | null;
        /**
         * Payment terms period in days; required if `payment_terms` are included, but can be `null`
         * @example 30
         */
        payment_terms_period?: string | null;
        /**
         * Account phone number
         * @example "6176354500"
         */
        phone?: string | null;
        /**
         * Account phone number extension
         * @example null
         */
        phone_ext?: string | null;
        /**
         * When `true` any contact associated with this account will be allowed to check out with a purchase order.
         * @example true
         */
        purchase_orders_enabled?: boolean;
        /** the accounts salesperson */
        salesperson?: {
          /**
           * The salespersons email address. Must correspond to an active team member in your Paperless Parts account.
           * @example "careers@paperlessparts.com"
           */
          email?: string;
        } | null;
        /** The address for the account's headquarters. */
        sold_to_address?: {
          /**
           * The street address
           * @example "137 Portland St."
           */
          address1?: string;
          /**
           * Unit
           * @example "Unit 1"
           */
          address2?: string | null;
          /**
           * The city of the address
           * @example "Boston"
           */
          city?: string;
          /**
           * The three character country abbreviation
           * @example "USA"
           */
          country?: string;
          /**
           * The postal code for the address
           * @example "02114"
           */
          postal_code?: string;
          /**
           * The two character state abbreviation
           * @example "MA"
           */
          state?: string;
          /**
           * The unique identifier for this address record in the ERP
           * @maxLength 50
           * @example "B1234"
           */
          erp_code?: string;
        };
        /**
         * When `true`, sales tax will not be added to a quote
         * @example true
         */
        tax_exempt?: boolean;
        /**
         * Sales tax rate for this Account
         * @example 6.25
         */
        tax_rate?: number | null;
        /**
         * Type of this Account, either customer or vendor
         * @example "customer"
         */
        type?: string;
        /** @example "https://paperlessparts.com" */
        url?: string | null;
      },
      params: RequestParams = {}
    ) =>
      this.request<Account, any>({
        path: `/accounts/public`,
        method: "POST",
        body: data,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description Get all Account attributes, including a list of billing addresses.
     *
     * @tags Customers
     * @name AccountDetails
     * @summary Get details about an Account
     * @request GET:/accounts/public/{accountId}
     * @secure
     */
    accountDetails: (accountId: AccountId, params: RequestParams = {}) =>
      this.request<Account, AccountLocator>({
        path: `/accounts/public/${accountId}`,
        method: "GET",
        secure: true,
        format: "json",
        ...params,
      }),

    /**
     * @description Partially update Account attributes (not including associated entities)
     *
     * @tags Customers
     * @name UpdateCompany
     * @summary Update an Account
     * @request PATCH:/accounts/public/{accountId}
     * @secure
     */
    updateCompany: (
      accountId: AccountId,
      data: {
        /**
         * (Required) Account Name (must be non-null and non-blank)
         * @example "Paperless Parts, Inc."
         */
        name?: string;
        /**
         * An account's credit line
         * @example 10000
         */
        credit_line?: number | null;
        /**
         * Erp code for the account
         * @example "PPI"
         */
        erp_code?: string | null;
        /** Account notes */
        notes?: string | null;
        /**
         * Payment terms; required if `payment_terms_period` are included
         * @example "Net 30"
         */
        payment_terms?: string | null;
        /**
         * Payment terms period in days; required if `payment_terms` are included, but can be `null`
         * @example 30
         */
        payment_terms_period?: string | null;
        /**
         * Account phone number
         * @example "6176354500"
         */
        phone?: string | null;
        /**
         * Account phone number extension
         * @example null
         */
        phone_ext?: string | null;
        /**
         * When `true` any contact associated with this account will be allowed to check out with a purchase order.
         * @example true
         */
        purchase_orders_enabled?: boolean;
        /** the accounts salesperson */
        salesperson?: {
          /**
           * The salespersons email address. Must correspond to an active team member in your Paperless Parts account.
           * @example "careers@paperlessparts.com"
           */
          email?: string;
        } | null;
        /** The address for the account's headquarters. If a sold_to_address is present on the account then individual fields can be patched otherwise all fields are required. */
        sold_to_address?: {
          /**
           * The street address
           * @example "137 Portland St."
           */
          address1?: string;
          /**
           * Unit
           * @example "Unit 1"
           */
          address2?: string | null;
          /**
           * The city of the address
           * @example "Boston"
           */
          city?: string;
          /**
           * The three character country abbreviation
           * @example "USA"
           */
          country?: string;
          /**
           * The postal code for the address
           * @example "02114"
           */
          postal_code?: string;
          /**
           * The two character state abbreviation
           * @example "MA"
           */
          state?: string;
          /**
           * The unique identifier for this address record in the ERP
           * @maxLength 50
           * @example "B1234"
           */
          erp_code?: string;
        };
        /**
         * When `true`, sales tax will not be added to a quote
         * @example true
         */
        tax_exempt?: boolean;
        /**
         * Sales tax rate for this Account
         * @example 6.25
         */
        tax_rate?: number | null;
        /**
         * Type of this Account, either customer or vendor
         * @example "customer"
         */
        type?: string;
        /** @example "https://paperlessparts.comA" */
        url?: string | null;
      },
      params: RequestParams = {}
    ) =>
      this.request<Account, any>({
        path: `/accounts/public/${accountId}`,
        method: "PATCH",
        body: data,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description List all billing addresses associated with an account
     *
     * @tags Customers
     * @name ListBillingAddresses
     * @summary List account billing addresses
     * @request GET:/accounts/public/{accountId}/billing_addresses
     * @secure
     */
    listBillingAddresses: (accountId: AccountId, params: RequestParams = {}) =>
      this.request<Address[], AccountLocator>({
        path: `/accounts/public/${accountId}/billing_addresses`,
        method: "GET",
        secure: true,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Customers
     * @name CreateBillingAddress
     * @summary Create a new billing address for an account
     * @request POST:/accounts/public/{accountId}/billing_addresses
     * @secure
     */
    createBillingAddress: (
      accountId: AccountId,
      data: Address,
      params: RequestParams = {}
    ) =>
      this.request<AddressInfo, any>({
        path: `/accounts/public/${accountId}/billing_addresses`,
        method: "POST",
        body: data,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description List all facilities associated with an account
     *
     * @tags Customers
     * @name ListFacilities
     * @summary List account facilites
     * @request GET:/accounts/public/{accountId}/facilities
     * @secure
     */
    listFacilities: (accountId: AccountId, params: RequestParams = {}) =>
      this.request<Facility[], AccountLocator>({
        path: `/accounts/public/${accountId}/facilities`,
        method: "GET",
        secure: true,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Customers
     * @name CreateFacility
     * @summary Create a new facility for an account
     * @request POST:/accounts/public/{accountId}/facilities
     * @secure
     */
    createFacility: (
      accountId: AccountId,
      data: {
        /**
         * Name of Facility
         * @example "Boston Office"
         */
        name?: string | null;
        /** The person or department to ship packages to at the facility */
        attention?: string | null;
        /** The address of the facility. */
        address?: {
          /**
           * The street address
           * @example "137 Portland St."
           */
          address1?: string;
          /**
           * Unit
           * @example "Unit 1"
           */
          address2?: string | null;
          /**
           * The city of the address
           * @example "Boston"
           */
          city?: string;
          /**
           * The three character country abbreviation
           * @example "USA"
           */
          country?: string;
          /**
           * The postal code for the address
           * @example "02114"
           */
          postal_code?: string;
          /**
           * The two character state abbreviation
           * @example "MA"
           */
          state?: string;
          /**
           * The unique identifier for this address record in the ERP
           * @maxLength 50
           * @example "B1234"
           */
          erp_code?: string;
        };
        /** the contacts salesperson */
        salesperson?: {
          /**
           * The salespersons email address. Must correspond to an active team member in your Paperless Parts account.
           * @example "careers@paperlessparts.com"
           */
          email?: string;
        } | null;
      },
      params: RequestParams = {}
    ) =>
      this.request<Facility, any>({
        path: `/accounts/public/${accountId}/facilities`,
        method: "POST",
        body: data,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),
  };
  billingAddresses = {
    /**
     * @description Get a sepecific billing address
     *
     * @tags Customers
     * @name BillingAddress
     * @summary Get Billing Address
     * @request GET:/billing_addresses/public/{billingAddressId}
     * @secure
     */
    billingAddress: (
      billingAddressId: BillingAddressId,
      params: RequestParams = {}
    ) =>
      this.request<Address, AccountLocator>({
        path: `/billing_addresses/public/${billingAddressId}`,
        method: "GET",
        secure: true,
        format: "json",
        ...params,
      }),

    /**
     * @description Partially update a Billing Address
     *
     * @tags Customers
     * @name UpdateBillingAddress
     * @summary Update a Billing Address
     * @request PATCH:/billing_addresses/public/{billingAddressId}
     * @secure
     */
    updateBillingAddress: (
      billingAddressId: BillingAddressId,
      data: {
        /**
         * The street address
         * @example "137 Portland St."
         */
        address1?: string;
        /**
         * Unit
         * @example "Unit 1"
         */
        address2?: string | null;
        /**
         * The city of the address
         * @example "Boston"
         */
        city?: string;
        /**
         * The three character country abbreviation
         * @example "USA"
         */
        country?: string;
        /**
         * The postal code for the address
         * @example "02114"
         */
        postal_code?: string;
        /**
         * The two character state abbreviation
         * @example "MA"
         */
        state?: string;
        /**
         * The unique identifier for this address record in the ERP
         * @maxLength 50
         * @example "B1234"
         */
        erp_code?: string;
      },
      params: RequestParams = {}
    ) =>
      this.request<Account, any>({
        path: `/billing_addresses/public/${billingAddressId}`,
        method: "PATCH",
        body: data,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),
  };
  facilities = {
    /**
     * @description Get a sepecific facility
     *
     * @tags Customers
     * @name Facility
     * @summary Get A Facility
     * @request GET:/facilities/public/{facilityId}
     * @secure
     */
    facility: (facilityId: FacilityId, params: RequestParams = {}) =>
      this.request<Facility, AccountLocator>({
        path: `/facilities/public/${facilityId}`,
        method: "GET",
        secure: true,
        format: "json",
        ...params,
      }),

    /**
     * @description Partially update a Facility
     *
     * @tags Customers
     * @name UpdateFacility
     * @summary Update a Facility
     * @request PATCH:/facilities/public/{facilityId}
     * @secure
     */
    updateFacility: (
      facilityId: FacilityId,
      data: {
        address?: {
          /**
           * The street address
           * @example "137 Portland St."
           */
          address1?: string;
          /**
           * Unit
           * @example "Unit 1"
           */
          address2?: string | null;
          /**
           * The city of the address
           * @example "Boston"
           */
          city?: string;
          /**
           * The three character country abbreviation
           * @example "USA"
           */
          country?: string;
          /**
           * The postal code for the address
           * @example "02114"
           */
          postal_code?: string;
          /**
           * The two character state abbreviation
           * @example "MA"
           */
          state?: string;
          /**
           * The unique identifier for this address record in the ERP
           * @maxLength 50
           * @example "B1234"
           */
          erp_code?: string;
        };
        /**
         * The person or department to ship packages to at the facility
         * @example "Gordon Moore"
         */
        attention?: string;
        /**
         * The name of the facility
         * @example "Boston HQ"
         */
        name?: string;
        /** the contacts salesperson */
        salesperson?: {
          /**
           * The salespersons email address. Must correspond to an active team member in your Paperless Parts account.
           * @example "careers@paperlessparts.com"
           */
          email?: string;
        } | null;
      },
      params: RequestParams = {}
    ) =>
      this.request<Facility, any>({
        path: `/facilities/public/${facilityId}`,
        method: "PATCH",
        body: data,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),
  };
  customers = {
    /**
     * @description Returns a list of payment terms available to be used for accounts.
     *
     * @tags Customers
     * @name ListPaymentTerms
     * @summary Returns a list of payment terms
     * @request GET:/customers/public/payment_terms
     * @secure
     */
    listPaymentTerms: (params: RequestParams = {}) =>
      this.request<
        {
          /**
           * the ID of the payment terms
           * @example 26198
           */
          id?: number;
          /**
           * the label for the payment terms
           * @example "Net 30 days"
           */
          label?: string;
          /**
           * number of days before payment is due
           * @example 30
           */
          period?: number;
        }[],
        AccountLocator
      >({
        path: `/customers/public/payment_terms`,
        method: "GET",
        secure: true,
        format: "json",
        ...params,
      }),
  };
  suppliers = {
    /**
     * @description Get a list of all the custom tables defined for this account.
     *
     * @tags Custom Tables
     * @name GetCustomTablesList
     * @summary Get a list of all the custom tables defined for this account.
     * @request GET:/suppliers/public/custom_tables
     * @secure
     */
    getCustomTablesList: (params: RequestParams = {}) =>
      this.request<CustomTableListResults, AccountLocator>({
        path: `/suppliers/public/custom_tables`,
        method: "GET",
        secure: true,
        format: "json",
        ...params,
      }),

    /**
     * @description Create a new custom table by supplying a name.
     *
     * @tags Custom Tables
     * @name CreateNewCustomTable
     * @summary Create a new custom table.
     * @request POST:/suppliers/public/custom_tables
     * @secure
     */
    createNewCustomTable: (data: CustomTableName, params: RequestParams = {}) =>
      this.request<CustomTableName, AccountLocator>({
        path: `/suppliers/public/custom_tables`,
        method: "POST",
        body: data,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description Get the details for a single table.
     *
     * @tags Custom Tables
     * @name GetCustomTableDetails
     * @summary Get the details for a single table.
     * @request GET:/suppliers/public/custom_tables/{tableName}
     * @secure
     */
    getCustomTableDetails: (tableName: TableName, params: RequestParams = {}) =>
      this.request<CustomTableDetails, AccountLocator>({
        path: `/suppliers/public/custom_tables/${tableName}`,
        method: "GET",
        secure: true,
        format: "json",
        ...params,
      }),

    /**
     * @description Update a table's definition. You may rename the table, supply a new configuration, or supply new row data. Supplying new data without a new configuration will drop the existing data and populate the table with the new data (assuming the table has previously been configured) - this is not an append operation. Supplying a new configuration without new table data will apply the configuration and clear the table data. Supplying both a new configuration and new data will apply the configuration, drop the existing data, and populate the table with the new data.
     *
     * @tags Custom Tables
     * @name UpdateCustomTableDetails
     * @summary Update a table's definition.
     * @request PATCH:/suppliers/public/custom_tables/{tableName}
     * @secure
     */
    updateCustomTableDetails: (
      tableName: TableName,
      data: CustomTableBody,
      params: RequestParams = {}
    ) =>
      this.request<CustomTableDetails, AccountLocator>({
        path: `/suppliers/public/custom_tables/${tableName}`,
        method: "PATCH",
        body: data,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description List all purchased components
     *
     * @tags Purchased Components
     * @name ListPurchasedComponents
     * @summary List purchased components
     * @request GET:/suppliers/public/purchased_components
     * @secure
     */
    listPurchasedComponents: (
      query?: {
        /** Value used to search against oem_part_number and internal_part_number. Comparisons are not case sensitive and will match when the field value includes the search value as a substring. */
        search?: string;
        /**
         * The page of results to return.
         * @default 1
         */
        page?: string;
        /**
         * The page size of results to return. Default subject to change.
         * @default 500
         */
        page_size?: string;
      },
      params: RequestParams = {}
    ) =>
      this.request<PurchasedComponent[], any>({
        path: `/suppliers/public/purchased_components`,
        method: "GET",
        query: query,
        secure: true,
        format: "json",
        ...params,
      }),

    /**
     * @description Create a purchased component
     *
     * @tags Purchased Components
     * @name CreatePurchasedComponent
     * @summary Create purchased component
     * @request POST:/suppliers/public/purchased_components
     * @secure
     */
    createPurchasedComponent: (
      data: PostPurchasedComponent,
      params: RequestParams = {}
    ) =>
      this.request<PurchasedComponent[], any>({
        path: `/suppliers/public/purchased_components`,
        method: "POST",
        body: data,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description Update a purchased component
     *
     * @tags Purchased Components
     * @name UpdatePurchasedComponent
     * @summary Update purchased component
     * @request PATCH:/suppliers/public/purchased_components/{purchasedComponentId}
     * @secure
     */
    updatePurchasedComponent: (
      purchasedComponentId: PurchasedComponentId,
      data: PatchPurchasedComponent,
      params: RequestParams = {}
    ) =>
      this.request<PurchasedComponent[], AccountLocator>({
        path: `/suppliers/public/purchased_components/${purchasedComponentId}`,
        method: "PATCH",
        body: data,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description Delete a purchased component
     *
     * @tags Purchased Components
     * @name DeletePurchasedComponent
     * @summary Delete purchased component
     * @request DELETE:/suppliers/public/purchased_components/{purchasedComponentId}
     * @secure
     */
    deletePurchasedComponent: (
      purchasedComponentId: PurchasedComponentId,
      params: RequestParams = {}
    ) =>
      this.request<void, AccountLocator>({
        path: `/suppliers/public/purchased_components/${purchasedComponentId}`,
        method: "DELETE",
        secure: true,
        ...params,
      }),

    /**
     * @description List all custom purchased components columns
     *
     * @tags Purchased Components
     * @name ListPurchasedComponentsColumns
     * @summary List purchased components columns
     * @request GET:/suppliers/public/purchased_component_columns
     * @secure
     */
    listPurchasedComponentsColumns: (params: RequestParams = {}) =>
      this.request<PurchasedComponentsColumn[], any>({
        path: `/suppliers/public/purchased_component_columns`,
        method: "GET",
        secure: true,
        format: "json",
        ...params,
      }),

    /**
     * @description Creates a new custom purchased components columns
     *
     * @tags Purchased Components
     * @name CreatePurchasedComponentsColumn
     * @summary Create purchased components columns
     * @request POST:/suppliers/public/purchased_component_columns
     * @secure
     */
    createPurchasedComponentsColumn: (
      data: PostPurchasedComponentsColumn,
      params: RequestParams = {}
    ) =>
      this.request<PurchasedComponentsColumn[], any>({
        path: `/suppliers/public/purchased_component_columns`,
        method: "POST",
        body: data,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description Updates an existing custom purchased components columns
     *
     * @tags Purchased Components
     * @name UpdatePurchasedComponentsColumn
     * @summary Update purchased components columns
     * @request PATCH:/suppliers/public/purchased_component_columns/{purchasedComponentsColumnId}
     * @secure
     */
    updatePurchasedComponentsColumn: (
      purchasedComponentsColumnId: PurchasedComponentsColumnId,
      data: PatchPurchasedComponentsColumn,
      params: RequestParams = {}
    ) =>
      this.request<PurchasedComponentsColumn[], AccountLocator>({
        path: `/suppliers/public/purchased_component_columns/${purchasedComponentsColumnId}`,
        method: "PATCH",
        body: data,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description Deletes an existing custom purchased components columns
     *
     * @tags Purchased Components
     * @name DeletePurchasedComponentsColumn
     * @summary Delete purchased components columns
     * @request DELETE:/suppliers/public/purchased_component_columns/{purchasedComponentsColumnId}
     * @secure
     */
    deletePurchasedComponentsColumn: (
      purchasedComponentsColumnId: PurchasedComponentsColumnId,
      params: RequestParams = {}
    ) =>
      this.request<void, AccountLocator>({
        path: `/suppliers/public/purchased_component_columns/${purchasedComponentsColumnId}`,
        method: "DELETE",
        secure: true,
        ...params,
      }),

    /**
     * @description Retrieve all purchased components for account in csv format
     *
     * @tags Purchased Components
     * @name GetPurchasedComponentCsv
     * @summary Retrieve purchased components csv
     * @request GET:/suppliers/public/purchased_components_csv
     * @secure
     */
    getPurchasedComponentCsv: (params: RequestParams = {}) =>
      this.request<AccountLocator, any>({
        path: `/suppliers/public/purchased_components_csv`,
        method: "GET",
        secure: true,
        ...params,
      }),

    /**
     * @description Replace all purchased components for account based on uploaded csv
     *
     * @tags Purchased Components
     * @name PostPurchasedComponentCsv
     * @summary Upload purchased components csv
     * @request POST:/suppliers/public/purchased_components_csv
     * @secure
     */
    postPurchasedComponentCsv: (
      data: {
        /** @format binary */
        csv_file?: File;
      },
      params: RequestParams = {}
    ) =>
      this.request<void, any>({
        path: `/suppliers/public/purchased_components_csv`,
        method: "POST",
        body: data,
        secure: true,
        type: ContentType.FormData,
        ...params,
      }),
  };
  managedIntegrations = {
    /**
     * @description Returns a list of managed integrations. Use the ID provided from the managed integration to create integration actions
     *
     * @tags Integration Actions
     * @name ListManagedIntegrations
     * @summary Returns a list of managed integrations
     * @request GET:/managed_integrations/public
     * @secure
     */
    listManagedIntegrations: (params: RequestParams = {}) =>
      this.request<ManagedIntegrationDetails[], AccountLocator>({
        path: `/managed_integrations/public`,
        method: "GET",
        secure: true,
        format: "json",
        ...params,
      }),

    /**
     * @description Creates a new managed integration. This is required to later create integration actions
     *
     * @tags Integration Actions
     * @name CreateManagedIntegration
     * @summary Create managed integration
     * @request POST:/managed_integrations/public
     * @secure
     */
    createManagedIntegration: (
      data: ManagedIntegration,
      params: RequestParams = {}
    ) =>
      this.request<ManagedIntegrationDetails, any>({
        path: `/managed_integrations/public`,
        method: "POST",
        body: data,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description Get the details for a managed integration
     *
     * @tags Integration Actions
     * @name GetManagedIntegration
     * @summary Get managed integration details
     * @request GET:/managed_integrations/public/{managedIntegrationId}
     * @secure
     */
    getManagedIntegration: (
      managedIntegrationId: string,
      params: RequestParams = {}
    ) =>
      this.request<ManagedIntegrationDetails, AccountLocator>({
        path: `/managed_integrations/public/${managedIntegrationId}`,
        method: "GET",
        secure: true,
        format: "json",
        ...params,
      }),

    /**
     * @description Update fields on a managed integration. Cannot update ID or erp_name
     *
     * @tags Integration Actions
     * @name UpdateManagedIntegration
     * @summary Update fields on a managed integration
     * @request PATCH:/managed_integrations/public/{managedIntegrationId}
     * @secure
     */
    updateManagedIntegration: (
      managedIntegrationId: string,
      data: {
        /**
         * whether the integration is active
         * @example true
         */
        is_active?: boolean;
        /**
         * The version of the ERP system being integrated with
         * @example "1.0"
         */
        erp_version?: string;
        /**
         * The version of the codebase processing the integration
         * @example "1.0"
         */
        integration_version?: string;
        /**
         * Whether a new integration action should be created after a new order is faciliated in Paperless
         * @example true
         */
        create_integration_action_after_creating_new_order?: boolean;
        /**
         * Whether a new integration action should be created after a new quote is sent in Paperless
         * @example true
         */
        create_integration_action_after_quote_sent?: boolean;
      },
      params: RequestParams = {}
    ) =>
      this.request<ManagedIntegrationDetails, any>({
        path: `/managed_integrations/public/${managedIntegrationId}`,
        method: "PATCH",
        body: data,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description Returns a list of integration actions available to be used for ERP integrations.
     *
     * @tags Integration Actions
     * @name ListIntegrationActions
     * @summary Returns a list of integration actions
     * @request GET:/managed_integrations/public/{managedIntegrationId}/integration_actions
     * @secure
     */
    listIntegrationActions: (
      managedIntegrationId: string,
      query?: {
        /** Value used to search for only integrations that current have a certain status. Valid options are queued, in_progress, completed, canceled, failed, or timed_out */
        status?: string;
        /** Value used to search for only integrations that current have a certain action_type. Valid options are export_order, export_quote, import_purchased_component, import_work_center, import_vendor, import_material, or import_account */
        action_type?: string;
        /** The page of results to return. */
        page?: string;
      },
      params: RequestParams = {}
    ) =>
      this.request<IntegrationAction[], AccountLocator>({
        path: `/managed_integrations/public/${managedIntegrationId}/integration_actions`,
        method: "GET",
        query: query,
        secure: true,
        format: "json",
        ...params,
      }),

    /**
     * @description Creates a new integration action
     *
     * @tags Integration Actions
     * @name CreateIntegrationAction
     * @summary Create new integration action
     * @request POST:/managed_integrations/public/{managedIntegrationId}/integration_actions
     * @secure
     */
    createIntegrationAction: (
      managedIntegrationId: string,
      data: {
        /**
         * the type of action being requested
         * @example "export_order"
         */
        action_type?: string;
        /**
         * The identifier for the entity that should be processed as part of the action. For example, process order 8
         * @example "8"
         */
        entity_id?: string;
      },
      params: RequestParams = {}
    ) =>
      this.request<IntegrationAction, any>({
        path: `/managed_integrations/public/${managedIntegrationId}/integration_actions`,
        method: "POST",
        body: data,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * @description Get the details for a specific integration action.
     *
     * @tags Integration Actions
     * @name GetIntegrationActionDetails
     * @summary Get integration action details
     * @request GET:/managed_integrations/public/{managedIntegrationId}/integration_actions/{action_uuid}
     * @secure
     */
    getIntegrationActionDetails: (
      managedIntegrationId: string,
      actionUuid: string,
      params: RequestParams = {}
    ) =>
      this.request<IntegrationAction, AccountLocator>({
        path: `/managed_integrations/public/${managedIntegrationId}/integration_actions/${actionUuid}`,
        method: "GET",
        secure: true,
        format: "json",
        ...params,
      }),

    /**
     * @description Update fields on an integration action.
     *
     * @tags Integration Actions
     * @name UpdateOrder
     * @summary Update fields on an integration action
     * @request PATCH:/managed_integrations/public/{managedIntegrationId}/integration_actions/{action_uuid}
     * @secure
     */
    updateOrder: (
      managedIntegrationId: string,
      actionUuid: string,
      data: {
        /**
         * the new status of the integration action
         * @example "in_progress"
         */
        status?: string;
        /**
         * The new status message for the integration
         * @example "The order 8 is now processing"
         */
        status_message?: string;
      },
      params: RequestParams = {}
    ) =>
      this.request<IntegrationAction, any>({
        path: `/managed_integrations/public/${managedIntegrationId}/integration_actions/${actionUuid}`,
        method: "PATCH",
        body: data,
        secure: true,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),
  };
}
