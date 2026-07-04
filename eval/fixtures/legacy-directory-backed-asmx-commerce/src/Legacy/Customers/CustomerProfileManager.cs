namespace Acme.Legacy.Customers;

public class CustomerProfileManager
{
  private readonly CustomerProfileRepository _repository = new CustomerProfileRepository();

  public string ReviewRisk(string customerId)
  {
    return _repository.LoadRiskSnapshot(customerId);
  }
}
