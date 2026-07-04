CREATE TABLE billing.refund_audit_entries (
  id bigint PRIMARY KEY,
  refund_id bigint NOT NULL,
  audit_state varchar(32) NOT NULL,
  ledger_entry_id bigint NOT NULL
);

CREATE TABLE billing.refund_ledger_entries (
  id bigint PRIMARY KEY,
  refund_id bigint NOT NULL,
  posted_at timestamp NULL
);

CREATE VIEW billing.refund_audit_snapshot AS
SELECT a.refund_id, l.posted_at
FROM billing.refund_audit_entries a
JOIN billing.refund_ledger_entries l ON l.refund_id = a.refund_id;
