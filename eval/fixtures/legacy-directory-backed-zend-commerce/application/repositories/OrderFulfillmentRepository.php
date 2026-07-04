<?php
class OrderFulfillmentRepository
{
  public function writeZendFulfillmentReprice() {
    $sql = "SELECT * FROM orders.zend_order_fulfillment_backlog";
    return $sql;
  }
}
