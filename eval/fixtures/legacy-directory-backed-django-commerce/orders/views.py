from .services import OrderFulfillmentService

def reprice_fulfillment(request, order_id):
    service = OrderFulfillmentService()
    return service.reprice_order(order_id)
