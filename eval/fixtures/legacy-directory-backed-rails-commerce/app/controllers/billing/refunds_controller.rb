require_dependency "billing/refund_service"

class Billing::RefundsController < ApplicationController
  def audit
    service = Billing::RefundService.new
    render json: service.audit_refund(params[:refund_id])
  end
end
