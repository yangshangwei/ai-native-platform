package com.acme.legacy.customers;

public class CustomerProfileService {
  private final CustomerProfileRepository customerProfileRepository = new CustomerProfileRepository();

  public CustomerRiskResult reviewProfileRisk(String customerId) {
    return customerProfileRepository.loadProfileRiskSnapshot(customerId);
  }
}
