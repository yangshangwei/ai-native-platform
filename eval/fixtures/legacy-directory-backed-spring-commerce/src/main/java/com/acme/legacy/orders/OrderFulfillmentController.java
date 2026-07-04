package com.acme.legacy.orders;

@RestController
@RequestMapping("/api/v5/orders")
public class OrderFulfillmentController {
  private final OrderFulfillmentService orderFulfillmentService = new OrderFulfillmentService();

  @PatchMapping("/fulfillment/{orderId}/reprice")
  public ResponseEntity<?> repriceFulfillment(String orderId) {
    return ResponseEntity.ok(orderFulfillmentService.repriceOrder(orderId));
  }
}
