package com.acme.legacy.orders;
import javax.jws.WebMethod;
import javax.jws.WebService;

@WebService(serviceName = "OrderFulfillmentService")
public class OrderFulfillmentService {
  private final OrderFulfillmentManager orderFulfillmentManager = new OrderFulfillmentManager();

  @WebMethod(operationName = "RepriceFulfillment")
  public FulfillmentRepriceResult repriceFulfillment(String orderId) {
    return orderFulfillmentManager.repriceBacklog(orderId);
  }
}
