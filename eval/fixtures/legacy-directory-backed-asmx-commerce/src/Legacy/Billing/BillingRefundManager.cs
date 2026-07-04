namespace Acme.Legacy.Billing;

public class BillingRefundManager
{
  private readonly BillingRefundRepository _repository = new BillingRefundRepository();

  public string RebuildRefundAudit(string refundId)
  {
    return _repository.WriteRefundAuditEntry(refundId);
  }
}
