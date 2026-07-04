namespace Acme.Legacy.Orders;

public class OrderFulfillmentService : IOrderFulfillmentContract
{
  private readonly OrderFulfillmentManager _manager = new OrderFulfillmentManager();

  public string RepriceFulfillment(string orderId)
  {
    return _manager.RepriceOrder(orderId);
  }
}
