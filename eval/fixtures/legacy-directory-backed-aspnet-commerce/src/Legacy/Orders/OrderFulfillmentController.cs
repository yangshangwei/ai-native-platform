namespace Acme.Legacy.Orders;

[ApiController]
[Route("api/v6/orders")]
public class OrderFulfillmentController : ControllerBase
{
  private readonly OrderFulfillmentService _orderFulfillmentService = new OrderFulfillmentService();

  [HttpPatch("fulfillment/{orderId}/reprice")]
  public IActionResult RepriceFulfillment(string orderId)
  {
    return Ok(_orderFulfillmentService.RepriceOrder(orderId));
  }
}
