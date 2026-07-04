<?php
class OrderFulfillmentService
{
  public function repriceCodeIgniterFulfillment() {
    $repository = new OrderFulfillmentRepository();
    return $repository->writeCodeIgniterFulfillmentBacklog();
  }
}
