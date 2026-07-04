<?php
return [
  'components' => [
    'urlManager' => [
      'rules' => [
        'billing/statements' => 'billing/statement/index',
        [
          'pattern' => 'POST billing/refunds/review',
          'route' => 'billing/refund/review',
        ],
        [
          'pattern' => 'orders/fulfillment/reprice',
          'route' => 'order/fulfillment/reprice',
        ],
        [
          'pattern' => 'customers/profile/risk',
          'route' => 'customer/profile/risk',
        ],
        [
          'pattern' => 'billing/generated',
          'route' => $dynamicRoute,
        ],
      ],
    ],
  ],
];
