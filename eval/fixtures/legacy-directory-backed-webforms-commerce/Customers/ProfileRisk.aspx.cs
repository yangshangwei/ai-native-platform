namespace Acme.Legacy.Customers;

public partial class ProfileRiskPage : System.Web.UI.Page
{
  private readonly CustomerProfileService _customerProfileService = new CustomerProfileService();

  protected void Page_Load(object sender, EventArgs e)
  {
    _customerProfileService.ReviewRisk(Request.QueryString["customerId"]);
  }
}
