namespace Acme.Legacy.Orders;

public partial class FulfillmentPage : System.Web.UI.Page
{
  private readonly OrderFulfillmentService _orderFulfillmentService = new OrderFulfillmentService();

  protected void Page_Load(object sender, EventArgs e)
  {
    _orderFulfillmentService.RepriceBacklog(Request.QueryString["orderId"]);
  }
}
