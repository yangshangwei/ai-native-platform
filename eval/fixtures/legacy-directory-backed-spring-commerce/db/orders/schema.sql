CREATE TABLE orders.spring_order_fulfillment_backlog (
  id bigint PRIMARY KEY,
  order_id bigint NOT NULL,
  repriced_at timestamp NULL
);
