<?php
class CustomerRiskRepository
{
  public function loadRiskScores() {
    $sql = "SELECT * FROM customers.customer_risk_scores WHERE score > 80";
    return $sql;
  }
}
