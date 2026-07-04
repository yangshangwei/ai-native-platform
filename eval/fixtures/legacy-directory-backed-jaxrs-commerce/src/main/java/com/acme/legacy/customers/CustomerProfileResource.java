package com.acme.legacy.customers;

@Path("/v9/customers")
public class CustomerProfileResource {
  private final CustomerProfileService customerProfileService = new CustomerProfileService();

  @GET
  @Path("/profiles/{customerId}/risk")
  public Response reviewProfileRisk(String customerId) {
    return Response.ok(customerProfileService.reviewProfileRisk(customerId)).build();
  }
}
