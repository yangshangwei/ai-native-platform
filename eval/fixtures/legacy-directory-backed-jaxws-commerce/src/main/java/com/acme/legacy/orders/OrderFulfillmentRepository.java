package com.acme.legacy.orders;

public class OrderFulfillmentRepository {
  public FulfillmentRepriceResult writeFulfillmentReprice(String orderId) {
    String sql = "SELECT * FROM orders.jaxws_order_fulfillment_backlog WHERE order_id = ?";
    return new FulfillmentRepriceResult(sql);
  }
}
