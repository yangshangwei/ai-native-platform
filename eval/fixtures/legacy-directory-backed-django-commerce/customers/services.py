from .repositories import CustomerProfileRepository

class CustomerProfileService:
    def review_profile_risk(self, customer_id):
        repository = CustomerProfileRepository()
        return repository.load_profile_risk(customer_id)
