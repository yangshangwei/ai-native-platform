using System.Web.Services;

namespace Acme.Legacy.Orders;

[WebService(Name = "OrderFulfillmentService", Namespace = "http://legacy.example/orders")]
public class OrderFulfillmentService : WebService
{
  private readonly OrderFulfillmentManager _manager = new OrderFulfillmentManager();

  [WebMethod(MessageName = "RepriceFulfillment")]
  public string RepriceFulfillment(string orderId)
  {
    return _manager.RepriceBacklog(orderId);
  }
}
