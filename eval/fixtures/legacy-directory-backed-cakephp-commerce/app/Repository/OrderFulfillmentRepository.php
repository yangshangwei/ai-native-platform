<?php
class OrderFulfillmentRepository
{
  public function writeCakeFulfillmentReprice() {
    $sql = "SELECT * FROM orders.cake_order_fulfillment_backlog";
    return $sql;
  }
}
