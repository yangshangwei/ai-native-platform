class Customers::ProfileRepository
  def load_profile(customer_id)
    sql = "SELECT * FROM customer_profile_snapshots WHERE customer_id = #{customer_id}"
    sql
  end
end
