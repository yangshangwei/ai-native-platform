namespace Acme.Legacy.Customers;

public class CustomerProfileService
{
  private readonly CustomerProfileRepository _customerProfileRepository = new CustomerProfileRepository();

  public CustomerRiskResult ReviewProfileRisk(string customerId)
  {
    return _customerProfileRepository.LoadProfileRiskSnapshot(customerId);
  }
}
