CREATE PROCEDURE reconcile_billing_settlements()
BEGIN
  UPDATE billing.settlement_batches
     SET reconciled_at = CURRENT_TIMESTAMP
   WHERE reconciled_at IS NULL;

  INSERT INTO billing.settlement_reconciliation_audit (batch_id, item_count)
  SELECT b.id, count(i.id)
    FROM billing.settlement_batches b
    JOIN billing.settlement_batch_items i ON i.batch_id = b.id
   GROUP BY b.id;
END;
