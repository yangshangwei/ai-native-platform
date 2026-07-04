<?php
Router::connect('/billing/refunds/review', array('controller' => 'billing', 'action' => 'reviewRefund'));
Router::connect('/orders/fulfillment/reprice', array('controller' => 'orders', 'action' => 'repriceFulfillment'));
Router::connect('/customers/profile/risk', array('controller' => 'customers', 'action' => 'riskProfile'));
Router::connect('/billing/:id', array('controller' => 'billing', 'action' => 'view'));
