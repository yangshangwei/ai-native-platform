<?php

namespace App\Repositories;

class CustomerProfileRepository
{
  public function loadProfileRiskSnapshot($customer) {
    $sql = "SELECT * FROM customers.laravel_customer_profile_snapshots WHERE customer_id = ?";
    return $sql;
  }
}
