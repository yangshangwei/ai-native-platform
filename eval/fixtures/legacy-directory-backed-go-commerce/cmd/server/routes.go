package main

import (
  "net/http"

  billing "legacy-commerce/internal/billing"
  customers "legacy-commerce/internal/customers"
  orders "legacy-commerce/internal/orders"
)

func RegisterRoutes() {
  mux.HandleFunc("/api/v7/billing/refunds/{refundID}/audit", auditRefund).Methods(http.MethodPost)
  mux.HandleFunc("/api/v7/orders/fulfillment/{orderID}/reprice", repriceFulfillment).Methods("PATCH")
  http.HandleFunc("/api/v7/customers/profiles/{customerID}/risk", reviewCustomerRisk)
}

func auditRefund() {
  service := billing.NewBillingRefundService()
  service.RebuildRefundAudit("refund_1")
}

func repriceFulfillment() {
  service := orders.NewOrderFulfillmentService()
  service.RepriceOrder("order_1")
}

func reviewCustomerRisk() {
  service := customers.NewCustomerProfileService()
  service.ReviewProfileRisk("customer_1")
}
