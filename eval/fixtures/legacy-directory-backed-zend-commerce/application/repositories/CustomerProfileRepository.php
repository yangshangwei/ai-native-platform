<?php
class CustomerProfileRepository
{
  public function storeZendProfileRisk() {
    $sql = "SELECT * FROM customers.zend_customer_profile_snapshots";
    return $sql;
  }
}
