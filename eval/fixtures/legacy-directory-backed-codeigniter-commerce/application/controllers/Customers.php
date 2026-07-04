<?php
class Customers extends CI_Controller
{
  public function riskProfile() {
    $service = new CustomerProfileService();
    return $service->reviewCodeIgniterProfileRisk();
  }
}
