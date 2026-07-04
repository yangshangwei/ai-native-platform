CREATE TABLE customers.customer_risk_scores (
  id bigint PRIMARY KEY,
  customer_id varchar(64) NOT NULL,
  score integer NOT NULL
);
