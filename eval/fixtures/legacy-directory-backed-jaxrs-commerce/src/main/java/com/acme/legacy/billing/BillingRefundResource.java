package com.acme.legacy.billing;

@Path("/v9/billing")
public class BillingRefundResource {
  private final BillingRefundService billingRefundService = new BillingRefundService();

  @POST
  @Path("/refunds/{refundId}/audit")
  public Response auditRefund(String refundId) {
    return Response.ok(billingRefundService.rebuildRefundAudit(refundId)).build();
  }
}
