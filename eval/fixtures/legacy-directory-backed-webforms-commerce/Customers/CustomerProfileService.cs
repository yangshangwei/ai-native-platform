namespace Acme.Legacy.Customers;

public class CustomerProfileService
{
  private readonly CustomerProfileRepository _customerProfileRepository = new CustomerProfileRepository();

  public string ReviewRisk(string customerId)
  {
    return _customerProfileRepository.LoadRiskSnapshot(customerId);
  }
}
