using System.ServiceModel;

namespace Acme.Legacy.Billing;

[ServiceContract(Name = "BillingRefundService")]
public interface IBillingRefundContract
{
  [OperationContract(Name = "AuditRefund")]
  string AuditRefund(string refundId);
}
