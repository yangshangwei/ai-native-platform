<?php
class BillingSettlementService
{
  public function reconcileSettlementBatch() {
    $repository = new BillingLedgerRepository();
    return $repository->applyReconciliation();
  }
}
