package com.acme.legacy.orders;

public class OrderFulfillmentService {
  private final OrderFulfillmentRepository orderFulfillmentRepository = new OrderFulfillmentRepository();

  public OrderRepriceResult repriceOrder(String orderId) {
    return orderFulfillmentRepository.repriceFulfillmentBacklog(orderId);
  }
}
