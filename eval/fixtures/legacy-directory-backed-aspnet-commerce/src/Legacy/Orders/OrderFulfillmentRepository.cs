namespace Acme.Legacy.Orders;

public class OrderFulfillmentRepository
{
  public OrderRepriceResult RepriceFulfillmentBacklog(string orderId)
  {
    var sql = "SELECT * FROM orders.aspnet_order_fulfillment_backlog WHERE order_id = @orderId";
    return new OrderRepriceResult(sql);
  }
}
