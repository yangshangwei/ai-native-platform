CREATE PROCEDURE rebuild_zend_refund_review()
BEGIN
  INSERT INTO billing.zend_refund_review_entries (refund_id, review_state, ledger_entry_id)
  SELECT l.refund_id, 'needs_review', l.id
    FROM billing.zend_refund_ledger_entries l
   WHERE l.posted_at IS NULL;
END;
