namespace Acme.Legacy.Tests.Orders;

public class FulfillmentPageTests
{
  public void RepricesFulfillmentThroughWebFormsPage()
  {
    new Acme.Legacy.Orders.OrderFulfillmentService().RepriceBacklog("order-77");
  }
}
