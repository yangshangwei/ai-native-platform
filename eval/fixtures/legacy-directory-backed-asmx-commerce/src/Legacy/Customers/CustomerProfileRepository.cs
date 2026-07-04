namespace Acme.Legacy.Customers;

public class CustomerProfileRepository
{
  public string LoadRiskSnapshot(string customerId)
  {
    string sql = "SELECT * FROM customers.asmx_customer_profile_snapshots WHERE customer_id = @customerId";
    return sql;
  }
}
