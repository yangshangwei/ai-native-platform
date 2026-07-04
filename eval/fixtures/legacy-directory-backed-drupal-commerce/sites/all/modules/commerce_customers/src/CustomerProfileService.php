<?php
class CustomerProfileService
{
  public function reviewDrupalProfileRisk() {
    $repository = new CustomerProfileRepository();
    return $repository->writeDrupalProfileSnapshot();
  }
}
