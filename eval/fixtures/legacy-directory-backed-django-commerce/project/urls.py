from django.urls import include, path

urlpatterns = [
    path("api/v3/billing/", include(("billing.urls", "billing"), namespace="billing")),
    path("api/v3/orders/", include(("orders.urls", "orders"), namespace="orders")),
    path("api/v3/customers/", include(("customers.urls", "customers"), namespace="customers")),
]
