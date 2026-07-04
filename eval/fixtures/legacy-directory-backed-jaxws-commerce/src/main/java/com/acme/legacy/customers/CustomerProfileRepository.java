package com.acme.legacy.customers;

public class CustomerProfileRepository {
  public ProfileRiskResult loadRiskSnapshot(String customerId) {
    String sql = "SELECT * FROM customers.jaxws_customer_profile_snapshots WHERE customer_id = ?";
    return new ProfileRiskResult(sql);
  }
}
