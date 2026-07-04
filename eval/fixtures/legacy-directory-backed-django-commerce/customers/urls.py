from django.urls import path
from . import views

urlpatterns = [
    path("profiles/<int:customer_id>/risk/", views.profile_risk_review),
]
