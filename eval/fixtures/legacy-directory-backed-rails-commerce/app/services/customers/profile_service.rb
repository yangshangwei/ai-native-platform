require_dependency "customers/profile_repository"

class Customers::ProfileService
  def load_profile(customer_id)
    repository = Customers::ProfileRepository.new
    repository.load_profile(customer_id)
  end
end
