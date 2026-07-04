namespace Acme.Legacy.Customers;

[ApiController]
[Route("api/v6/customers")]
public class CustomerProfileController : ControllerBase
{
  private readonly CustomerProfileService _customerProfileService = new CustomerProfileService();

  [HttpGet("profiles/{customerId}/risk")]
  public IActionResult ReviewRisk(string customerId)
  {
    return Ok(_customerProfileService.ReviewProfileRisk(customerId));
  }
}
