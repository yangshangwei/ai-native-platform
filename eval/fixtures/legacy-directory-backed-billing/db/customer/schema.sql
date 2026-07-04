CREATE TABLE customer_account_ledgers (
  id bigint PRIMARY KEY,
  customer_id varchar(64) NOT NULL,
  last_statement_at timestamp NULL
);
