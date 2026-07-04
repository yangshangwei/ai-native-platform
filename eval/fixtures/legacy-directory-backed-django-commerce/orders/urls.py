from django.urls import path
from . import views

urlpatterns = [
    path("fulfillment/<int:order_id>/reprice/", views.reprice_fulfillment),
]
