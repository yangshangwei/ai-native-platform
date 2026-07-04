CREATE TABLE billing.aspnet_refund_audit_entries (
  id bigint PRIMARY KEY,
  refund_id bigint NOT NULL,
  audit_state varchar(32) NOT NULL,
  ledger_entry_id bigint NOT NULL
);

CREATE TABLE billing.aspnet_refund_ledger_entries (
  id bigint PRIMARY KEY,
  refund_id bigint NOT NULL,
  posted_at datetime NULL
);

CREATE VIEW billing.aspnet_refund_audit_snapshot AS
SELECT a.refund_id, l.posted_at
FROM billing.aspnet_refund_audit_entries a
JOIN billing.aspnet_refund_ledger_entries l ON l.refund_id = a.refund_id;
