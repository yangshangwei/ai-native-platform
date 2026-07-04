CREATE TABLE refund_audit_entries (
  id bigint PRIMARY KEY,
  refund_id bigint NOT NULL,
  audit_state varchar(32) NOT NULL,
  reconciled_at timestamp NULL
);
