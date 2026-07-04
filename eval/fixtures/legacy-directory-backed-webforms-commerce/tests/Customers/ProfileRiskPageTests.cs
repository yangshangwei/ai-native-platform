namespace Acme.Legacy.Tests.Customers;

public class ProfileRiskPageTests
{
  public void ReviewsProfileRiskThroughWebFormsPage()
  {
    new Acme.Legacy.Customers.CustomerProfileService().ReviewRisk("customer-22");
  }
}
