require_dependency "customers/profile_service"

class Customers::ProfileController < ApplicationController
  def show
    service = Customers::ProfileService.new
    render json: service.load_profile(params[:customer_id])
  end
end
