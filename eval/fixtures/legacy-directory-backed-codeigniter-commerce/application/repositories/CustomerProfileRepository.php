<?php
class CustomerProfileRepository
{
  public function writeCodeIgniterProfileSnapshot() {
    $sql = "SELECT * FROM customers.codeigniter_customer_profile_snapshots WHERE risk_state = 'review'";
    return $sql;
  }
}
