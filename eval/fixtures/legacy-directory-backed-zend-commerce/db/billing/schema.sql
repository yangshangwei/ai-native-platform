CREATE TABLE billing.zend_refund_review_entries (
  id bigint PRIMARY KEY,
  refund_id bigint NOT NULL,
  review_state varchar(32) NOT NULL,
  ledger_entry_id bigint NOT NULL
);

CREATE TABLE billing.zend_refund_ledger_entries (
  id bigint PRIMARY KEY,
  refund_id bigint NOT NULL,
  posted_at timestamp NULL
);

CREATE VIEW billing.zend_refund_review_snapshot AS
SELECT r.refund_id, l.posted_at
FROM billing.zend_refund_review_entries r
JOIN billing.zend_refund_ledger_entries l ON l.refund_id = r.refund_id;
