<?php
class OrderFulfillmentRepository
{
  public function writeCodeIgniterFulfillmentBacklog() {
    $sql = "SELECT * FROM orders.codeigniter_order_fulfillment_backlog WHERE repriced_at IS NULL";
    return $sql;
  }
}
