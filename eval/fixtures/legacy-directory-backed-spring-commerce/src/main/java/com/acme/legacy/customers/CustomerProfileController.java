package com.acme.legacy.customers;

@RestController
@RequestMapping("/api/v5/customers")
public class CustomerProfileController {
  private final CustomerProfileService customerProfileService = new CustomerProfileService();

  @GetMapping("/profiles/{customerId}/risk")
  public ResponseEntity<?> reviewRisk(String customerId) {
    return ResponseEntity.ok(customerProfileService.reviewProfileRisk(customerId));
  }
}
