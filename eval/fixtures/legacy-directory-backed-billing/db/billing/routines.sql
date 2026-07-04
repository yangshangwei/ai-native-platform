CREATE PROCEDURE apply_refund_settlement(refund_id varchar(64))
BEGIN
  UPDATE billing.refund_ledger_entries
     SET settled_at = CURRENT_TIMESTAMP
   WHERE refund_ledger_entries.refund_id = refund_id;

  INSERT INTO billing.refund_settlement_audit (refund_id, ledger_entry_id)
  SELECT refund_id, id
    FROM billing.refund_ledger_entries
   WHERE refund_ledger_entries.refund_id = refund_id;
END;
