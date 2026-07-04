CREATE PROCEDURE apply_refund_audit_entry(refund_id bigint)
LANGUAGE SQL
AS $$
  INSERT INTO refund_audit_entries (refund_id, audit_state)
  VALUES (refund_id, 'pending_review');
$$;
