namespace Acme.Legacy.Orders;

public class OrderFulfillmentService
{
  private readonly OrderFulfillmentRepository _orderFulfillmentRepository = new OrderFulfillmentRepository();

  public string RepriceBacklog(string orderId)
  {
    return _orderFulfillmentRepository.WriteFulfillmentReprice(orderId);
  }
}
