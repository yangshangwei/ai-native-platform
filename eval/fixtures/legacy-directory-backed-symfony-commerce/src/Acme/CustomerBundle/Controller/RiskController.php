<?php
class RiskController
{
  public function reviewAction() {
    $service = new CustomerRiskService();
    return $service->reviewRiskScores();
  }
}
