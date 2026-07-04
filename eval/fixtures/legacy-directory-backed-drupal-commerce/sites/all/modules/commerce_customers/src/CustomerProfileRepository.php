<?php
class CustomerProfileRepository
{
  public function writeDrupalProfileSnapshot() {
    return "SELECT * FROM customers.drupal_customer_profile_snapshots";
  }
}
