-- SPDX-License-Identifier: AGPL-3.0-only
-- Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
-- including ports, remain AGPLv3; serving them over a network requires releasing their source.

-- calculate_quantity_to_order, Demand-Based Reorder: the maximum order
-- quantity caps ONE order, never the week's need. The total is the whole
-- shortfall (at least the minimum, a whole order multiple); the TypeScript
-- twin (computePlanningOrders, @carbon/utils planning-sizing.ts) splits it
-- into orders of min(lotSize, maximumOrderQuantity). Capping the total left
-- one order of the maximum per window and the rest of the need unplanned.
-- Forked from 20260324120000_planning-quantity-to-order.sql.

-- Helper function to calculate total quantity to order based on reorder policy
CREATE OR REPLACE FUNCTION calculate_quantity_to_order(
  p_reordering_policy "itemReorderingPolicy",
  p_reorder_point INTEGER,
  p_reorder_quantity INTEGER,
  p_minimum_order_quantity INTEGER,
  p_maximum_order_quantity INTEGER,
  p_order_multiple INTEGER,
  p_lot_size INTEGER,
  p_maximum_inventory_quantity NUMERIC,
  p_demand_accumulation_period INTEGER,
  p_demand_accumulation_safety_stock NUMERIC,
  p_projections NUMERIC[]
) RETURNS NUMERIC AS $$
DECLARE
  ordered_quantity NUMERIC := 0;
  num_periods INTEGER;
  projected_stock NUMERIC;
  projected_quantity NUMERIC;
  remaining_needed NUMERIC;
  total_order_qty NUMERIC;
  order_qty NUMERIC;
  required_qty NUMERIC;
  i INTEGER;
  j INTEGER;
  iterations INTEGER;
  window_length INTEGER;
BEGIN
  num_periods := COALESCE(array_length(p_projections, 1), 0);
  IF num_periods = 0 THEN RETURN 0; END IF;

  CASE p_reordering_policy
    WHEN 'Manual Reorder' THEN
      RETURN 0;

    WHEN 'Demand-Based Reorder' THEN
      -- A stored period of 0 (or NULL) never advanced the loop; one week at least,
      -- as computePlanningOrders.
      window_length := GREATEST(1, COALESCE(p_demand_accumulation_period, 1));
      i := 1;
      WHILE i <= num_periods LOOP
        projected_stock := 0;
        j := i;
        WHILE j <= LEAST(i + window_length - 1, num_periods) LOOP
          projected_stock := COALESCE(p_projections[j], 0) + ordered_quantity;
          j := j + 1;
        END LOOP;

        IF projected_stock < p_demand_accumulation_safety_stock THEN
          total_order_qty := p_demand_accumulation_safety_stock - projected_stock;

          total_order_qty := GREATEST(total_order_qty, p_minimum_order_quantity);

          IF p_order_multiple > 0 THEN
            total_order_qty := CEIL(total_order_qty / p_order_multiple) * p_order_multiple;
          END IF;

          ordered_quantity := ordered_quantity + total_order_qty;
        END IF;

        i := i + window_length;
      END LOOP;
      RETURN ordered_quantity;

    WHEN 'Fixed Reorder Quantity' THEN
      FOR i IN 1..num_periods LOOP
        projected_quantity := COALESCE(p_projections[i], 0);
        remaining_needed := p_reorder_point - (projected_quantity + ordered_quantity);
        iterations := 0;
        WHILE remaining_needed > 0 AND iterations < 5 LOOP
          IF p_reorder_quantity > 0 THEN
            order_qty := p_reorder_quantity;
          ELSE
            order_qty := p_reorder_point;
          END IF;

          ordered_quantity := ordered_quantity + order_qty;
          remaining_needed := p_reorder_point - (projected_quantity + ordered_quantity);
          iterations := iterations + 1;
        END LOOP;
      END LOOP;
      RETURN ordered_quantity;

    WHEN 'Maximum Quantity' THEN
      FOR i IN 1..num_periods LOOP
        projected_quantity := COALESCE(p_projections[i], 0);
        remaining_needed := p_reorder_point - (projected_quantity + ordered_quantity);
        iterations := 0;
        WHILE remaining_needed > 0 AND iterations < 5 LOOP
          required_qty := p_maximum_inventory_quantity - (projected_quantity + ordered_quantity);

          IF p_reorder_quantity > 0 THEN
            order_qty := GREATEST(p_minimum_order_quantity, required_qty);
          ELSE
            order_qty := p_reorder_point;
          END IF;

          IF order_qty <= 0 THEN EXIT; END IF;

          IF p_order_multiple > 1 THEN
            order_qty := CEIL(order_qty / p_order_multiple) * p_order_multiple;
          END IF;

          IF p_lot_size > 0 THEN
            order_qty := CEIL(order_qty / p_lot_size) * p_lot_size;
          END IF;

          IF p_maximum_order_quantity > 0 THEN
            order_qty := LEAST(order_qty, p_maximum_order_quantity);
          END IF;

          ordered_quantity := ordered_quantity + order_qty;
          remaining_needed := p_reorder_point - (projected_quantity + ordered_quantity);
          iterations := iterations + 1;
        END LOOP;
      END LOOP;
      RETURN ordered_quantity;

    ELSE
      RETURN 0;
  END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
