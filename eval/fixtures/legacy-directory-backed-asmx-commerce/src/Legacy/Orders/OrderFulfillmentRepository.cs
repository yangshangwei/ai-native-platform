namespace Acme.Legacy.Orders;

public class OrderFulfillmentRepository
{
  public string WriteFulfillmentReprice(string orderId)
  {
    string sql = "SELECT * FROM orders.asmx_order_fulfillment_backlog WHERE order_id = @orderId";
    return sql;
  }
}
