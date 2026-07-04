CREATE TABLE customers.aspnet_customer_profile_snapshots (
  id bigint PRIMARY KEY,
  customer_id bigint NOT NULL,
  risk_state varchar(32) NOT NULL
);
