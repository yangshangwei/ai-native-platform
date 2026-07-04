<?php
class OrderFulfillmentRepository
{
  public function writeYiiFulfillmentReprice() {
    $sql = "SELECT * FROM orders.yii_order_fulfillment_backlog";
    return $sql;
  }
}
