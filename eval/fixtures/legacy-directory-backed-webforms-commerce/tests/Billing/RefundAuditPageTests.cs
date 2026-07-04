namespace Acme.Legacy.Tests.Billing;

public class RefundAuditPageTests
{
  public void RebuildsRefundAuditThroughWebFormsPage()
  {
    new Acme.Legacy.Billing.BillingRefundService().RebuildRefundAudit("refund-1024");
  }
}
