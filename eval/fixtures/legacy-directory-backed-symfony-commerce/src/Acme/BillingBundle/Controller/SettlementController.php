<?php
class SettlementController
{
  public function reconcileAction() {
    $service = new BillingSettlementService();
    return $service->reconcileSettlementBatch();
  }
}
