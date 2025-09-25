#!/bin/bash

# Script to get Load Balancer DNS names for Carbon ERP services
# Run this after deploying your SST application

echo "Getting Load Balancer information for Carbon services..."
echo "==========================================================="

# Get the region from your SST config
REGION="us-gov-east-1"

# Find load balancers with Carbon in the name or tags
echo "Finding Load Balancers..."
aws elbv2 describe-load-balancers \
  --region $REGION \
  --query 'LoadBalancers[?contains(LoadBalancerName, `carbon`) || contains(LoadBalancerName, `Carbon`)].{Name:LoadBalancerName,DNSName:DNSName,Type:Type,State:State.Code}' \
  --output table

echo ""
echo "If no results above, trying to find by tags..."

# Alternative: Find by tags (SST usually tags resources)
aws elbv2 describe-load-balancers \
  --region $REGION \
  --query 'LoadBalancers[].{Name:LoadBalancerName,DNSName:DNSName,Type:Type,State:State.Code}' \
  --output table

echo ""
echo "To get more detailed information about a specific load balancer, run:"
echo "aws elbv2 describe-load-balancers --region us-gov-east-1 --load-balancer-arns <ARN>"
echo ""
echo "Once you have the DNS name(s), create these DNS records in your domain provider:"
echo "1. CNAME record: itar.carbon.ms -> <ERP_LOAD_BALANCER_DNS_NAME>"
echo "2. CNAME record: mes.itar.carbon.ms -> <MES_LOAD_BALANCER_DNS_NAME>"

carbonmesservic-suwrtafs-1163782910.us-gov-east-1.elb.amazonaws.com
carbonerpservic-ktfsohkb-1407316043.us-gov-east-1.elb.amazonaws.com