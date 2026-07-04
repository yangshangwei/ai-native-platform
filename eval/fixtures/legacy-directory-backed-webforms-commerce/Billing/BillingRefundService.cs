namespace Acme.Legacy.Billing;

public class BillingRefundService
{
  private readonly BillingRefundRepository _billingRefundRepository = new BillingRefundRepository();

  public string RebuildRefundAudit(string refundId)
  {
    return _billingRefundRepository.WriteRefundAuditEntry(refundId);
  }
}
