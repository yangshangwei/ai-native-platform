namespace Acme.Legacy.Customers;

public class CustomerProfileRepository
{
  public CustomerRiskResult LoadProfileRiskSnapshot(string customerId)
  {
    var sql = "SELECT * FROM customers.aspnet_customer_profile_snapshots WHERE customer_id = @customerId";
    return new CustomerRiskResult(sql);
  }
}
