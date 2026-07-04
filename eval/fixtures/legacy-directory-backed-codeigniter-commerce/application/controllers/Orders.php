<?php
class Orders extends CI_Controller
{
  public function repriceFulfillment() {
    $service = new OrderFulfillmentService();
    return $service->repriceCodeIgniterFulfillment();
  }
}
