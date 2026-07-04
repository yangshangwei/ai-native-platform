namespace Acme.Legacy.Billing;

[ApiController]
[Route("api/v6/billing")]
public class BillingRefundController : ControllerBase
{
  private readonly BillingRefundService _billingRefundService = new BillingRefundService();

  [HttpPost("refunds/{refundId}/audit")]
  public IActionResult AuditRefund(string refundId)
  {
    return Ok(_billingRefundService.RebuildRefundAudit(refundId));
  }
}
