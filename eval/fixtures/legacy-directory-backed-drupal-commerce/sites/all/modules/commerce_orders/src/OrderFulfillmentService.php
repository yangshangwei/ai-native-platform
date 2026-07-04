<?php
class OrderFulfillmentService
{
  public function repriceDrupalFulfillment() {
    $repository = new OrderFulfillmentRepository();
    return $repository->writeDrupalFulfillmentBacklog();
  }
}
