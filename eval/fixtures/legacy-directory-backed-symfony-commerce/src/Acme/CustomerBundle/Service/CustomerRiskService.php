<?php
class CustomerRiskService
{
  public function reviewRiskScores() {
    $repository = new CustomerRiskRepository();
    return $repository->loadRiskScores();
  }
}
