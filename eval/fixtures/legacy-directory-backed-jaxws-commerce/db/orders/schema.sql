CREATE TABLE orders.jaxws_order_fulfillment_backlog (
  id bigint PRIMARY KEY,
  order_id bigint NOT NULL,
  price_state varchar(32) NOT NULL
);
