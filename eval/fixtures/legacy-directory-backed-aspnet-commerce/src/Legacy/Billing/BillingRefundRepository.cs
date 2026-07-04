namespace Acme.Legacy.Billing;

public class BillingRefundRepository
{
  public RefundAuditResult WriteRefundAuditEntry(string refundId)
  {
    var sql = "EXEC billing.rebuild_aspnet_refund_audit; SELECT * FROM billing.aspnet_refund_audit_entries";
    return new RefundAuditResult(sql);
  }
}
