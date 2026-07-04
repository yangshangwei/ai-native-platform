using System.Web.Services;

namespace Acme.Legacy.Billing;

[WebService(Name = "BillingRefundService", Namespace = "http://legacy.example/billing")]
public class BillingRefundService : WebService
{
  private readonly BillingRefundManager _manager = new BillingRefundManager();

  [WebMethod(MessageName = "AuditRefund")]
  public string AuditRefund(string refundId)
  {
    return _manager.RebuildRefundAudit(refundId);
  }
}
