package com.acme.legacy.customers;
import javax.jws.WebMethod;
import javax.jws.WebService;

@WebService(serviceName = "CustomerProfileService")
public class CustomerProfileService {
  private final CustomerProfileManager customerProfileManager = new CustomerProfileManager();

  @WebMethod(operationName = "ReviewProfileRisk")
  public ProfileRiskResult reviewProfileRisk(String customerId) {
    return customerProfileManager.reviewRisk(customerId);
  }
}
