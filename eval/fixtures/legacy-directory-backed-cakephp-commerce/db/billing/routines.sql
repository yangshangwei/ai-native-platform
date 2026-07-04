CREATE PROCEDURE rebuild_cake_refund_review()
BEGIN
  INSERT INTO billing.cake_refund_review_entries (refund_id, review_state, ledger_entry_id)
  SELECT l.refund_id, 'needs_review', l.id
    FROM billing.cake_refund_ledger_entries l
   WHERE l.posted_at IS NULL;
END;
