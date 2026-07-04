package com.acme.legacy.orders;

public class OrderFulfillmentRepository {
  public OrderRepriceResult repriceFulfillmentBacklog(String orderId) {
    String sql = "SELECT * FROM orders.struts_order_fulfillment_backlog WHERE order_id = ?";
    return new OrderRepriceResult(sql);
  }
}
