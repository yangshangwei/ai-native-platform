namespace Acme.Legacy.Customers;

public class CustomerProfileManager
{
  private readonly CustomerProfileRepository _repository = new CustomerProfileRepository();

  public string ReviewProfileRisk(string customerId)
  {
    return _repository.LoadProfileRiskSnapshot(customerId);
  }
}
