from .repositories import OrderFulfillmentRepository

class OrderFulfillmentService:
    def reprice_order(self, order_id):
        repository = OrderFulfillmentRepository()
        return repository.reprice_fulfillment_queue(order_id)
