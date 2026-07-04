namespace Acme.Legacy.Billing;

public class BillingRefundService
{
  private readonly BillingRefundRepository _billingRefundRepository = new BillingRefundRepository();

  public RefundAuditResult RebuildRefundAudit(string refundId)
  {
    return _billingRefundRepository.WriteRefundAuditEntry(refundId);
  }
}
