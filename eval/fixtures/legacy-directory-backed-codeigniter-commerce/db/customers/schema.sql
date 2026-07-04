CREATE TABLE customers.codeigniter_customer_profile_snapshots (
  id bigint PRIMARY KEY,
  customer_id bigint NOT NULL,
  risk_state varchar(32) NOT NULL,
  reviewed_at timestamp NULL
);

CREATE VIEW customers.codeigniter_customer_profile_risk AS
SELECT customer_id, risk_state
FROM customers.codeigniter_customer_profile_snapshots;
