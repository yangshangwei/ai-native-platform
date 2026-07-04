CREATE TABLE customer_profile_snapshots (
  id bigint PRIMARY KEY,
  customer_id bigint NOT NULL,
  risk_band varchar(16) NOT NULL
);
