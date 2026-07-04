<?php
class CustomersController extends AppController
{
  public function riskProfile() {
    $service = new CustomerProfileService();
    return $service->rebuildCakeCustomerRisk();
  }
}
