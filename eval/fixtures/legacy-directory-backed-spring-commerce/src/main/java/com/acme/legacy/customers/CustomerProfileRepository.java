package com.acme.legacy.customers;

public class CustomerProfileRepository {
  public CustomerRiskResult loadProfileRiskSnapshot(String customerId) {
    String sql = "SELECT * FROM customers.spring_customer_profile_snapshots WHERE customer_id = ?";
    return new CustomerRiskResult(sql);
  }
}
