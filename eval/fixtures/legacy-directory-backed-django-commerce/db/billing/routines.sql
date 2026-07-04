CREATE PROCEDURE rebuild_refund_audit_entry()
BEGIN
  INSERT INTO billing.refund_audit_entries (refund_id, audit_state, ledger_entry_id)
  SELECT l.refund_id, 'pending_review', l.id
    FROM billing.refund_ledger_entries l
   WHERE l.posted_at IS NULL;
END;
