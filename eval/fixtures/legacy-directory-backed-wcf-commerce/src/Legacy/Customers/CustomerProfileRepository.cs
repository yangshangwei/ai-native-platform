namespace Acme.Legacy.Customers;

public class CustomerProfileRepository
{
  public string LoadProfileRiskSnapshot(string customerId)
  {
    string sql = "SELECT * FROM customers.wcf_customer_profile_snapshots WHERE customer_id = @customerId";
    return sql;
  }
}
