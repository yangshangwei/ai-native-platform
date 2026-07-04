using System.ServiceModel;

namespace Acme.Legacy.Orders;

[ServiceContract(Name = "OrderFulfillmentService")]
public interface IOrderFulfillmentContract
{
  [OperationContract(Name = "RepriceFulfillment")]
  string RepriceFulfillment(string orderId);
}
