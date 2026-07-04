package com.acme.legacy.orders;

@Path("/v9/orders")
public class OrderFulfillmentResource {
  private final OrderFulfillmentService orderFulfillmentService = new OrderFulfillmentService();

  @PATCH
  @Path("/fulfillment/{orderId}/reprice")
  public Response repriceFulfillment(String orderId) {
    return Response.ok(orderFulfillmentService.repriceOrder(orderId)).build();
  }
}
