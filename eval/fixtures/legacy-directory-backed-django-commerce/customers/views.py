from .services import CustomerProfileService

def profile_risk_review(request, customer_id):
    service = CustomerProfileService()
    return service.review_profile_risk(customer_id)
