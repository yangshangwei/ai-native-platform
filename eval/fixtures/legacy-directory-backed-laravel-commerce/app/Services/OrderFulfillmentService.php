<?php

namespace App\Services;

use App\Repositories\OrderFulfillmentRepository;

class OrderFulfillmentService
{
  public function repriceOrder($order) {
    $repository = new OrderFulfillmentRepository();
    return $repository->repriceFulfillmentBacklog($order);
  }
}
