namespace Acme.Legacy.Billing;

public class BillingRefundService : IBillingRefundContract
{
  private readonly BillingRefundManager _manager = new BillingRefundManager();

  public string AuditRefund(string refundId)
  {
    return _manager.RebuildRefundAudit(refundId);
  }
}
