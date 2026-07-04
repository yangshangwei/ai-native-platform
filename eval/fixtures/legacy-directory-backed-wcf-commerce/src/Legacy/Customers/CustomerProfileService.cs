namespace Acme.Legacy.Customers;

public class CustomerProfileService : ICustomerProfileContract
{
  private readonly CustomerProfileManager _manager = new CustomerProfileManager();

  public string ReviewProfileRisk(string customerId)
  {
    return _manager.ReviewProfileRisk(customerId);
  }
}
