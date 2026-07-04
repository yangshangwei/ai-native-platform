<?php
$route['default_controller'] = 'welcome';
$route['billing/refunds/audit'] = 'billing/auditRefund';
$route['orders/fulfillment/reprice'] = 'orders/repriceFulfillment';
$route['customers/profile/risk'] = 'customers/riskProfile';
$route['billing/refunds/(:num)'] = 'billing/show/$1';
