<?php
class OrderFulfillmentService
{
  public function repriceYiiFulfillment() {
    $repository = new OrderFulfillmentRepository();
    return $repository->writeYiiFulfillmentReprice();
  }
}
