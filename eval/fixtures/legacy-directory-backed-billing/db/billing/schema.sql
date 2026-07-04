CREATE TABLE billing.refund_ledger_entries (
  id bigint PRIMARY KEY,
  refund_id varchar(64) NOT NULL,
  settled_at timestamp NULL
);

CREATE TABLE billing.refund_settlement_audit (
  id bigint PRIMARY KEY,
  refund_id varchar(64) NOT NULL,
  ledger_entry_id bigint NOT NULL REFERENCES billing.refund_ledger_entries(id)
);

CREATE VIEW billing.refund_settlement_summary AS
SELECT e.refund_id, count(a.id) AS audit_count
FROM billing.refund_ledger_entries e
JOIN billing.refund_settlement_audit a ON a.ledger_entry_id = e.id
GROUP BY e.refund_id;
