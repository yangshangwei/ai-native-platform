using System.Web.Services;

namespace Acme.Legacy.Customers;

[WebService(Name = "CustomerProfileService", Namespace = "http://legacy.example/customers")]
public class CustomerProfileService : WebService
{
  private readonly CustomerProfileManager _manager = new CustomerProfileManager();

  [WebMethod(MessageName = "ReviewProfileRisk")]
  public string ReviewProfileRisk(string customerId)
  {
    return _manager.ReviewRisk(customerId);
  }
}
