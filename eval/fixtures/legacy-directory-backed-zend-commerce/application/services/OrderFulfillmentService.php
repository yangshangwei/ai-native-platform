<?php
class OrderFulfillmentService
{
  public function repriceZendFulfillment() {
    $repository = new OrderFulfillmentRepository();
    return $repository->writeZendFulfillmentReprice();
  }
}
