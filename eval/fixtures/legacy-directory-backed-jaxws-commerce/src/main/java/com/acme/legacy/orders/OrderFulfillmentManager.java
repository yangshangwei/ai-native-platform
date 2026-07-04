package com.acme.legacy.orders;

public class OrderFulfillmentManager {
  private final OrderFulfillmentRepository orderFulfillmentRepository = new OrderFulfillmentRepository();

  public FulfillmentRepriceResult repriceBacklog(String orderId) {
    return orderFulfillmentRepository.writeFulfillmentReprice(orderId);
  }
}
