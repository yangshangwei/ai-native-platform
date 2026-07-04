<?php
class CustomerProfileService
{
  public function rebuildYiiCustomerRisk() {
    $repository = new CustomerProfileRepository();
    return $repository->writeYiiCustomerRisk();
  }
}
