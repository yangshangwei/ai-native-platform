<?php

class BillingRefundController extends Controller
{
  public function auditRefund($refund) {
    $service = new \App\Services\BillingRefundService();
    return response()->json($service->rebuildRefundAudit($refund));
  }
}
