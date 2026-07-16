#!/usr/bin/env bash
# Reproduce: Shipping a partially-completed serialized job shows empty shipment lines
# This script uses Supabase REST API + direct Postgres to set up the scenario

set -euo pipefail

API="https://api.main.dev"
ANON="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0NzgzMzgsImV4cCI6MjA5NzgzODMzOH0.AC0e3vAPk6OruoyzK7HpYvplSb9H3P-8EG-BvV-k_yQ"
SERVICE="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjQ3ODMzOCwiZXhwIjoyMDk3ODM4MzM4fQ.ET3uy7H_R8R5_tLl1hNDgyDCM9GWcvSr7zYwzwdxIzs"
DB="postgresql://postgres:postgres@localhost:35079/postgres"

H1="apikey: $SERVICE"
H2="Authorization: Bearer $SERVICE"
H3="Content-Type: application/json"
H4="Prefer: return=representation"

echo "=== Step 0: Get user + company IDs ==="
USER_ID=$(psql "$DB" -tAc "SELECT id FROM auth.users LIMIT 1")
echo "User: $USER_ID"

COMPANY_ID=$(psql "$DB" -tAc "SELECT id FROM \"company\" LIMIT 1" 2>/dev/null || echo "")
if [ -z "$COMPANY_ID" ]; then
  echo "No company found. Creating one..."
  COMPANY_ID=$(psql "$DB" -tAc "INSERT INTO \"company\" (name, \"taxId\") VALUES ('Test Mfg Co', '12-3456789') RETURNING id")
fi
echo "Company: $COMPANY_ID"

# Get or create employee
EMPLOYEE_ID=$(psql "$DB" -tAc "SELECT id FROM employee WHERE \"companyId\" = '$COMPANY_ID' LIMIT 1" 2>/dev/null || echo "")
if [ -z "$EMPLOYEE_ID" ]; then
  echo "Creating employee..."
  EMPLOYEE_ID=$(psql "$DB" -tAc "INSERT INTO employee (id, \"companyId\") VALUES ('$USER_ID', '$COMPANY_ID') RETURNING id")
fi
echo "Employee: $EMPLOYEE_ID"

# Get default location
LOCATION_ID=$(psql "$DB" -tAc "SELECT id FROM location WHERE \"companyId\" = '$COMPANY_ID' LIMIT 1" 2>/dev/null || echo "")
if [ -z "$LOCATION_ID" ]; then
  echo "Creating location..."
  LOCATION_ID=$(psql "$DB" -tAc "INSERT INTO location (name, \"companyId\") VALUES ('Main Warehouse', '$COMPANY_ID') RETURNING id")
fi
echo "Location: $LOCATION_ID"

echo ""
echo "=== Step 1: Create a serial-tracked part ==="
PART_GROUP_ID=$(psql "$DB" -tAc "SELECT id FROM \"partGroup\" WHERE \"companyId\" = '$COMPANY_ID' LIMIT 1" 2>/dev/null || echo "")
if [ -z "$PART_GROUP_ID" ]; then
  PART_GROUP_ID=$(psql "$DB" -tAc "INSERT INTO \"partGroup\" (name, \"companyId\") VALUES ('Default', '$COMPANY_ID') RETURNING id")
fi

PART_ID=$(psql "$DB" -tAc "
  INSERT INTO part (name, \"partType\", \"companyId\", \"replenishmentSystem\", \"partGroupId\", active)
  VALUES ('Serial Widget', 'Inventory', '$COMPANY_ID', 'Make', '$PART_GROUP_ID', true)
  RETURNING id
")
echo "Part: $PART_ID"

# Make it serialized  
psql "$DB" -c "
  UPDATE part 
  SET \"trackingType\" = 'Serial'
  WHERE id = '$PART_ID'
" 2>/dev/null || echo "(trackingType column may not exist, checking alternatives...)"

# Check schema for tracking
TRACKING_COL=$(psql "$DB" -tAc "SELECT column_name FROM information_schema.columns WHERE table_name = 'part' AND column_name LIKE '%track%' OR column_name LIKE '%serial%'" 2>/dev/null || echo "")
echo "Tracking columns: $TRACKING_COL"

echo ""
echo "=== Step 2: Create a sales order with 5 of this part ==="
# First, create a customer
CUSTOMER_ID=$(psql "$DB" -tAc "SELECT id FROM customer WHERE \"companyId\" = '$COMPANY_ID' LIMIT 1" 2>/dev/null || echo "")
if [ -z "$CUSTOMER_ID" ]; then
  CUSTOMER_ID=$(psql "$DB" -tAc "INSERT INTO customer (name, \"companyId\") VALUES ('Test Customer', '$COMPANY_ID') RETURNING id")
fi
echo "Customer: $CUSTOMER_ID"

SO_ID=$(psql "$DB" -tAc "
  INSERT INTO \"salesOrder\" (\"customerId\", \"companyId\", \"orderDate\", status, \"createdBy\")
  VALUES ('$CUSTOMER_ID', '$COMPANY_ID', NOW(), 'To Ship', '$USER_ID')
  RETURNING id
")
echo "Sales Order: $SO_ID"

SO_LINE_ID=$(psql "$DB" -tAc "
  INSERT INTO \"salesOrderLine\" (\"salesOrderId\", \"partId\", \"saleQuantity\", \"unitPrice\", \"locationId\", \"companyId\", status, \"orderQuantity\", \"createdBy\")
  VALUES ('$SO_ID', '$PART_ID', 5, 100.00, '$LOCATION_ID', '$COMPANY_ID', 'To Ship', 5, '$USER_ID')
  RETURNING id
")
echo "Sales Order Line: $SO_LINE_ID"

echo ""
echo "=== Step 3: Create a job for 5 of this part (Make to Order) ==="
JOB_ID=$(psql "$DB" -tAc "
  INSERT INTO job (name, \"partId\", quantity, status, \"companyId\", \"salesOrderId\", \"salesOrderLineId\", \"locationId\", \"createdBy\")
  VALUES ('JOB-001', '$PART_ID', 5, 'In Progress', '$COMPANY_ID', '$SO_ID', '$SO_LINE_ID', '$LOCATION_ID', '$USER_ID')
  RETURNING id
")
echo "Job: $JOB_ID"

echo ""
echo "=== Step 4: Simulate partial completion (2/5) ==="
# Set quantityComplete = 2 but leave quantityShipped at whatever it would be after complete route
psql "$DB" -c "
  UPDATE job 
  SET \"quantityComplete\" = 2
  WHERE id = '$JOB_ID'
"
echo "Set job.quantityComplete = 2"

echo ""
echo "=== Step 4b: Simulate the bug from complete route ==="
echo "The complete route sets quantityShipped = originalQuantity (5) instead of quantityComplete (2)"
psql "$DB" -c "
  UPDATE job 
  SET \"quantityShipped\" = 5
  WHERE id = '$JOB_ID'
"
echo "Set job.quantityShipped = 5 (this is the bug!)"

echo ""
echo "=== Step 5: Check what shipment creation would compute ==="
echo "quantityToShip = max(0, quantityComplete - quantityShipped) = max(0, 2 - 5) = 0"
QTY_COMPLETE=$(psql "$DB" -tAc "SELECT \"quantityComplete\" FROM job WHERE id = '$JOB_ID'")
QTY_SHIPPED=$(psql "$DB" -tAc "SELECT \"quantityShipped\" FROM job WHERE id = '$JOB_ID'")
QTY_ORIGINAL=$(psql "$DB" -tAc "SELECT quantity FROM job WHERE id = '$JOB_ID'")
echo "  job.quantity = $QTY_ORIGINAL"
echo "  job.quantityComplete = $QTY_COMPLETE"  
echo "  job.quantityShipped = $QTY_SHIPPED"
echo "  quantityToShip = max(0, $QTY_COMPLETE - $QTY_SHIPPED) = max(0, $(($QTY_COMPLETE - $QTY_SHIPPED))) = 0"
echo ""
echo "=== RESULT: isSerial && quantityToShip > 0 → false → NO SHIPMENT LINE CREATED ==="
echo ""
echo "=== Now let's verify with correct data (no bug) ==="
psql "$DB" -c "
  UPDATE job 
  SET \"quantityShipped\" = 0
  WHERE id = '$JOB_ID'
"
QTY_SHIPPED2=$(psql "$DB" -tAc "SELECT \"quantityShipped\" FROM job WHERE id = '$JOB_ID'")
echo "  Reset job.quantityShipped = $QTY_SHIPPED2"
echo "  quantityToShip = max(0, $QTY_COMPLETE - 0) = $QTY_COMPLETE"
echo "  isSerial && quantityToShip > 0 → true → SHIPMENT LINE WOULD BE CREATED"

echo ""
echo "=== Step 6: Now try the actual edge function ==="
# First, authenticate as the test user
AUTH_RESP=$(curl -sk "$API/auth/v1/signup" \
  -H "$H1" \
  -H "$H3" \
  -d "{\"email\":\"repro@test.com\",\"password\":\"testpass123\"}" 2>/dev/null || echo '{}')
echo "Auth signup: $(echo "$AUTH_RESP" | head -c 200)"

TOKEN=$(echo "$AUTH_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('access_token',''))" 2>/dev/null || echo "")
if [ -z "$TOKEN" ]; then
  echo "Trying login instead..."
  AUTH_RESP=$(curl -sk "$API/auth/v1/token?grant_type=password" \
    -H "$H1" \
    -H "$H3" \
    -d "{\"email\":\"repro@test.com\",\"password\":\"testpass123\"}" 2>/dev/null || echo '{}')
  TOKEN=$(echo "$AUTH_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('access_token',''))" 2>/dev/null || echo "")
fi

if [ -z "$TOKEN" ]; then
  echo "Using service role instead..."
  TOKEN="$SERVICE"
fi

echo ""
echo "=== Calling create edge function with buggy data (quantityShipped=5) ==="
psql "$DB" -c "UPDATE job SET \"quantityShipped\" = 5 WHERE id = '$JOB_ID'"

SHIPMENT_RESP=$(curl -sk "$API/functions/v1/create" \
  -H "apikey: $ANON" \
  -H "Authorization: Bearer $TOKEN" \
  -H "$H3" \
  -d "{
    \"type\": \"shipmentFromSalesOrderLine\",
    \"salesOrderId\": \"$SO_ID\",
    \"salesOrderLineId\": \"$SO_LINE_ID\",
    \"locationId\": \"$LOCATION_ID\",
    \"companyId\": \"$COMPANY_ID\"
  }" 2>/dev/null)
echo "Shipment creation response (buggy): $SHIPMENT_RESP"

# Check if shipment was created
SHIPMENT_ID=$(echo "$SHIPMENT_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null || echo "")
if [ -n "$SHIPMENT_ID" ]; then
  LINE_COUNT=$(psql "$DB" -tAc "SELECT COUNT(*) FROM \"shipmentLine\" WHERE \"shipmentId\" = '$SHIPMENT_ID'")
  echo "Shipment lines created: $LINE_COUNT (expected: 0 due to bug)"
else
  echo "No shipment created (or error)"
fi

echo ""
echo "=== Now try with correct data (quantityShipped=0) ==="
psql "$DB" -c "UPDATE job SET \"quantityShipped\" = 0 WHERE id = '$JOB_ID'"

SHIPMENT_RESP2=$(curl -sk "$API/functions/v1/create" \
  -H "apikey: $ANON" \
  -H "Authorization: Bearer $TOKEN" \
  -H "$H3" \
  -d "{
    \"type\": \"shipmentFromSalesOrderLine\",
    \"salesOrderId\": \"$SO_ID\",
    \"salesOrderLineId\": \"$SO_LINE_ID\",
    \"locationId\": \"$LOCATION_ID\",
    \"companyId\": \"$COMPANY_ID\"
  }" 2>/dev/null)
echo "Shipment creation response (fixed): $SHIPMENT_RESP2"

SHIPMENT_ID2=$(echo "$SHIPMENT_RESP2" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null || echo "")
if [ -n "$SHIPMENT_ID2" ]; then
  LINE_COUNT2=$(psql "$DB" -tAc "SELECT COUNT(*) FROM \"shipmentLine\" WHERE \"shipmentId\" = '$SHIPMENT_ID2'")
  echo "Shipment lines created: $LINE_COUNT2 (expected: >0 with fix)"
else
  echo "No shipment created (or error)"
fi

echo ""
echo "=== REPRODUCTION COMPLETE ==="
