<?php
class CustomerProfileService
{
  public function writeZendProfileRisk() {
    $repository = new CustomerProfileRepository();
    return $repository->storeZendProfileRisk();
  }
}
