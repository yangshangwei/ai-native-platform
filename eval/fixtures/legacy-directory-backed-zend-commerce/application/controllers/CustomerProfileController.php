<?php
class CustomerProfileController extends Zend_Controller_Action
{
  public function riskAction() {
    $service = new CustomerProfileService();
    return $service->writeZendProfileRisk();
  }
}
