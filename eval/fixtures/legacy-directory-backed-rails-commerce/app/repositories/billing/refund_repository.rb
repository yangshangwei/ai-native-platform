class Billing::RefundRepository
  def audit_refund(refund_id)
    sql = "SELECT * FROM refund_audit_entries WHERE refund_id = #{refund_id}"
    sql
  end
end
