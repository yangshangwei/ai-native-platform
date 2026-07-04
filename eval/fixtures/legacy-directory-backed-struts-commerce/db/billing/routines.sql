CREATE PROCEDURE rebuild_struts_refund_audit()
BEGIN
  INSERT INTO billing.struts_refund_audit_entries (refund_id, audit_state, ledger_entry_id)
  SELECT l.refund_id, 'pending_review', l.id
    FROM billing.struts_refund_ledger_entries l
   WHERE l.posted_at IS NULL;
END;
