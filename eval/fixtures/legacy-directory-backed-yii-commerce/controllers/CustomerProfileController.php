<?php
class CustomerProfileController extends \yii\web\Controller
{
  public function actionRisk() {
    $service = new CustomerProfileService();
    return $service->rebuildYiiCustomerRisk();
  }
}
