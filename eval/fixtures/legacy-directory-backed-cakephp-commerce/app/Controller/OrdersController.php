<?php
class OrdersController extends AppController
{
  public function repriceFulfillment() {
    $service = new OrderFulfillmentService();
    return $service->repriceCakeFulfillment();
  }
}
