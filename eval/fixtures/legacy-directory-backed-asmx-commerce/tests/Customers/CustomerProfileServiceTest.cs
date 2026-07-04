namespace Acme.Legacy.Tests.Customers;

public class CustomerProfileServiceTest
{
  public void ReviewsProfileRiskThroughAsmxService()
  {
    new Acme.Legacy.Customers.CustomerProfileService().ReviewProfileRisk("customer-22");
  }
}
