/** A stored URL alone never proves that an existing payment can still be paid. */
export function paymentAvailability(status: string, providerStatus: string | null, expiresAt: Date | null, checkoutUrl: string | null) {
  return {
    expiresAt: expiresAt?.toISOString() ?? null,
    failureReason: status === 'failed' && providerStatus === 'expired' ? 'expired' as const : null,
    canPay: status === 'checkout_pending' && ['created', 'qrcdata_created'].includes(providerStatus ?? '')
      && expiresAt !== null && expiresAt.getTime() > Date.now() && checkoutUrl !== null,
  };
}
