<?php
class BillingRefundController extends \yii\web\Controller
{
  public function actionReview() {
    $service = new BillingRefundService();
    return $service->rebuildYiiRefundReview();
  }
}
