<?php
class CustomerProfileRepository
{
  public function writeYiiCustomerRisk() {
    $sql = "SELECT * FROM customers.yii_customer_profile_snapshots";
    return $sql;
  }
}
