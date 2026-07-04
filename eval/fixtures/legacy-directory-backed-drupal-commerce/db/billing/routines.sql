CREATE PROCEDURE rebuild_drupal_refund_review()
BEGIN
  INSERT INTO billing.drupal_refund_review_entries (refund_id, review_state, ledger_entry_id)
  SELECT l.refund_id, 'pending_review', l.id
    FROM billing.drupal_refund_ledger_entries l
   WHERE l.posted_at IS NULL;
END;
