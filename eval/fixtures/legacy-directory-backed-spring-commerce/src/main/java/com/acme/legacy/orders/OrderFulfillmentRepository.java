package com.acme.legacy.orders;

public class OrderFulfillmentRepository {
  public OrderRepriceResult repriceFulfillmentBacklog(String orderId) {
    String sql = "SELECT * FROM orders.spring_order_fulfillment_backlog WHERE order_id = ?";
    return new OrderRepriceResult(sql);
  }
}
