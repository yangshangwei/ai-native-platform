<?php

Route::controller(BillingRefundController::class)->prefix('/api/v4/billing')->group(function () {
  Route::post('refunds/{refund}/audit', 'auditRefund');
});

Route::controller(OrderFulfillmentController::class)->prefix('/api/v4/orders')->group(function () {
  Route::patch('fulfillment/{order}/reprice', 'repriceFulfillment');
});

Route::controller(CustomerProfileController::class)->prefix('/api/v4/customers')->group(function () {
  Route::get('profiles/{customer}/risk', 'reviewRisk');
});
