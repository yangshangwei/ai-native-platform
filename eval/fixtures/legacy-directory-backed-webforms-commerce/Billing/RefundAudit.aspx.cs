namespace Acme.Legacy.Billing;

public partial class RefundAuditPage : System.Web.UI.Page
{
  private readonly BillingRefundService _billingRefundService = new BillingRefundService();

  protected void Page_Load(object sender, EventArgs e)
  {
    _billingRefundService.RebuildRefundAudit(Request.QueryString["refundId"]);
  }
}
