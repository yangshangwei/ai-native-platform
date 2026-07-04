namespace Acme.Legacy.Orders;

public class OrderFulfillmentManager
{
  private readonly OrderFulfillmentRepository _repository = new OrderFulfillmentRepository();

  public string RepriceBacklog(string orderId)
  {
    return _repository.WriteFulfillmentReprice(orderId);
  }
}
