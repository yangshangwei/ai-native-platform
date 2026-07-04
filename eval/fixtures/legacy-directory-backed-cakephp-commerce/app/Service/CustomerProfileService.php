<?php
class CustomerProfileService
{
  public function rebuildCakeCustomerRisk() {
    $repository = new CustomerProfileRepository();
    return $repository->writeCakeCustomerRisk();
  }
}
