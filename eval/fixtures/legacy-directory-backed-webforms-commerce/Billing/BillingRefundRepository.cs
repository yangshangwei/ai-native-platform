namespace Acme.Legacy.Billing;

public class BillingRefundRepository
{
  public string WriteRefundAuditEntry(string refundId)
  {
    string sql = "EXEC billing.rebuild_webforms_refund_audit; SELECT * FROM billing.webforms_refund_audit_entries";
    return sql;
  }
}
