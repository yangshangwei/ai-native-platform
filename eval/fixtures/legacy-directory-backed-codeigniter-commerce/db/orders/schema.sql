CREATE TABLE orders.codeigniter_order_fulfillment_backlog (
  id bigint PRIMARY KEY,
  order_id bigint NOT NULL,
  fulfillment_state varchar(32) NOT NULL,
  repriced_at timestamp NULL
);

CREATE VIEW orders.codeigniter_order_fulfillment_snapshot AS
SELECT order_id, fulfillment_state
FROM orders.codeigniter_order_fulfillment_backlog;
