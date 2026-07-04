<?php
class OrderFulfillmentRepository
{
  public function writeDrupalFulfillmentBacklog() {
    return "SELECT * FROM orders.drupal_order_fulfillment_backlog";
  }
}
