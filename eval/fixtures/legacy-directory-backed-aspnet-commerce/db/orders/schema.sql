CREATE TABLE orders.aspnet_order_fulfillment_backlog (
  id bigint PRIMARY KEY,
  order_id bigint NOT NULL,
  reprice_state varchar(32) NOT NULL
);
