namespace Acme.Legacy.Tests.Orders;

public class OrderFulfillmentServiceTest
{
  public void RepricesFulfillmentThroughAsmxService()
  {
    new Acme.Legacy.Orders.OrderFulfillmentService().RepriceFulfillment("order-77");
  }
}
