package com.acme.legacy.customers;

public class CustomerProfileAction extends Action {
  private final CustomerProfileService customerProfileService = new CustomerProfileService();

  public ActionForward execute() {
    customerProfileService.reviewProfileRisk(customerId);
    return mapping.findForward("risk");
  }
}
