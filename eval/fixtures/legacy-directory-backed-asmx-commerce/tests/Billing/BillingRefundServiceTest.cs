namespace Acme.Legacy.Tests.Billing;

public class BillingRefundServiceTest
{
  public void RebuildsRefundAuditThroughAsmxService()
  {
    new Acme.Legacy.Billing.BillingRefundService().AuditRefund("refund-1024");
  }
}
