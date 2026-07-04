package com.acme.legacy.orders;

public class OrderFulfillmentAction extends ActionSupport {
  private final OrderFulfillmentService orderFulfillmentService = new OrderFulfillmentService();

  public String execute() {
    orderFulfillmentService.repriceOrder(orderId);
    return SUCCESS;
  }
}
