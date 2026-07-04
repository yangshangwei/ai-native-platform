from django.urls import path
from . import views

urlpatterns = [
    path("refunds/<int:refund_id>/audit/", views.refund_audit),
]
