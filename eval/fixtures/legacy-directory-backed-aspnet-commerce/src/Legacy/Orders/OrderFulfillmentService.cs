namespace Acme.Legacy.Orders;

public class OrderFulfillmentService
{
  private readonly OrderFulfillmentRepository _orderFulfillmentRepository = new OrderFulfillmentRepository();

  public OrderRepriceResult RepriceOrder(string orderId)
  {
    return _orderFulfillmentRepository.RepriceFulfillmentBacklog(orderId);
  }
}
