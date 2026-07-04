<?php
class BillingLedgerRepository
{
  public function applyReconciliation() {
    $sql = "CALL reconcile_billing_settlements(); SELECT * FROM billing.settlement_batches JOIN billing.settlement_batch_items ON settlement_batch_items.batch_id = settlement_batches.id";
    return $sql;
  }
}
