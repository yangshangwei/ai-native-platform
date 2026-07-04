<?php
class CustomerProfileRepository
{
  public function writeCakeCustomerRisk() {
    $sql = "SELECT * FROM customers.cake_customer_profile_snapshots";
    return $sql;
  }
}
