CREATE TABLE billing.settlement_batches (
  id bigint PRIMARY KEY,
  batch_id varchar(64) NOT NULL,
  reconciled_at timestamp NULL
);

CREATE TABLE billing.settlement_batch_items (
  id bigint PRIMARY KEY,
  batch_id bigint NOT NULL,
  invoice_id varchar(64) NOT NULL,
  FOREIGN KEY (batch_id) REFERENCES billing.settlement_batches(id)
);

CREATE VIEW billing.settlement_reconciliation_snapshot AS
SELECT b.batch_id, count(i.id) AS item_count
FROM billing.settlement_batches b
JOIN billing.settlement_batch_items i ON i.batch_id = b.id
GROUP BY b.batch_id;
