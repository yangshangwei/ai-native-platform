<?php

namespace App\Repositories;

class OrderFulfillmentRepository
{
  public function repriceFulfillmentBacklog($order) {
    $sql = "SELECT * FROM orders.laravel_order_fulfillment_backlog WHERE order_id = ?";
    return $sql;
  }
}
