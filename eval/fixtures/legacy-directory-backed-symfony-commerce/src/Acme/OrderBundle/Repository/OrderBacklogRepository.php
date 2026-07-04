<?php
class OrderBacklogRepository
{
  public function loadBacklog() {
    $sql = "SELECT * FROM orders.order_backlog_items WHERE repriced_at IS NULL";
    return $sql;
  }
}
