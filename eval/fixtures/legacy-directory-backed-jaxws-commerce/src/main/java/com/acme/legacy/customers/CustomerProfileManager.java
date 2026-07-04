package com.acme.legacy.customers;

public class CustomerProfileManager {
  private final CustomerProfileRepository customerProfileRepository = new CustomerProfileRepository();

  public ProfileRiskResult reviewRisk(String customerId) {
    return customerProfileRepository.loadRiskSnapshot(customerId);
  }
}
