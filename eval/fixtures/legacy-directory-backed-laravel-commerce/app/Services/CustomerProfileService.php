<?php

namespace App\Services;

use App\Repositories\CustomerProfileRepository;

class CustomerProfileService
{
  public function reviewProfileRisk($customer) {
    $repository = new CustomerProfileRepository();
    return $repository->loadProfileRiskSnapshot($customer);
  }
}
