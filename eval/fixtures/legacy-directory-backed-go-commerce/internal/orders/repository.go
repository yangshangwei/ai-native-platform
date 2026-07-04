package orders

type OrderFulfillmentRepository struct {}

func (r *OrderFulfillmentRepository) RepriceFulfillmentBacklog(orderID string) OrderRepriceResult {
  sql := "SELECT * FROM orders.go_order_fulfillment_backlog WHERE order_id = ?"
  return OrderRepriceResult{SQL: sql}
}
