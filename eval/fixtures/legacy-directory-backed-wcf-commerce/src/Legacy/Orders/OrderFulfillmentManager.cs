namespace Acme.Legacy.Orders;

public class OrderFulfillmentManager
{
  private readonly OrderFulfillmentRepository _repository = new OrderFulfillmentRepository();

  public string RepriceOrder(string orderId)
  {
    return _repository.RepriceFulfillmentBacklog(orderId);
  }
}
