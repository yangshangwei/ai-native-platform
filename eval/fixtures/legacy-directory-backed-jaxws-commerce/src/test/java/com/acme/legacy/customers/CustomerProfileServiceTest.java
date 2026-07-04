package com.acme.legacy.customers;

public class CustomerProfileServiceTest {
  public void reviewsProfileRiskThroughSoapService() {
    new CustomerProfileService().reviewProfileRisk("customer-22");
  }
}
