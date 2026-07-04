package com.acme.legacy.orders;

public class OrderFulfillmentServiceTest {
  public void repricesFulfillmentThroughSoapService() {
    new OrderFulfillmentService().repriceFulfillment("order-77");
  }
}
