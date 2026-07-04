CREATE PROCEDURE billing.rebuild_aspnet_refund_audit
AS
BEGIN
  INSERT INTO billing.aspnet_refund_audit_entries (refund_id, audit_state, ledger_entry_id)
  SELECT l.refund_id, 'pending_review', l.id
    FROM billing.aspnet_refund_ledger_entries l
   WHERE l.posted_at IS NULL;
END;
