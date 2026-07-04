CREATE TABLE orders.order_backlog_items (
  id bigint PRIMARY KEY,
  order_id varchar(64) NOT NULL,
  repriced_at timestamp NULL
);
