namespace Acme.Legacy.Orders;

public class OrderFulfillmentRepository
{
  public string RepriceFulfillmentBacklog(string orderId)
  {
    string sql = "SELECT * FROM orders.wcf_order_fulfillment_backlog WHERE order_id = @orderId";
    return sql;
  }
}
