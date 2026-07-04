<?php
class OrderFulfillmentService
{
  public function repriceCakeFulfillment() {
    $repository = new OrderFulfillmentRepository();
    return $repository->writeCakeFulfillmentReprice();
  }
}
