<?php
class CustomerProfileService
{
  public function reviewCodeIgniterProfileRisk() {
    $repository = new CustomerProfileRepository();
    return $repository->writeCodeIgniterProfileSnapshot();
  }
}
