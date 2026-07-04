class OrderFulfillmentRepository:
    def reprice_fulfillment_queue(self, order_id):
        sql = "SELECT * FROM orders.order_fulfillment_backlog WHERE order_id = %s"
        return sql
