using System.ServiceModel;

namespace Acme.Legacy.Customers;

[ServiceContract(Name = "CustomerProfileService")]
public interface ICustomerProfileContract
{
  [OperationContract(Name = "ReviewProfileRisk")]
  string ReviewProfileRisk(string customerId);
}
