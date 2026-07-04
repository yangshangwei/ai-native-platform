class CustomerProfileRepository:
    def load_profile_risk(self, customer_id):
        sql = "SELECT * FROM customers.customer_profile_snapshots WHERE customer_id = %s"
        return sql
