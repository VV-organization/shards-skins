import { ApiProperty } from "@nestjs/swagger";

const paymentStatuses = ["provider_configuration_required", "provider_creation_pending", "checkout_pending", "paid", "failed", "manual_review"] as const;
const fulfillmentStatuses = ["held", "fulfilled", "partially_fulfilled", "failed", "manual_review"] as const;

export class PaymentHistoryItemDto {
  @ApiProperty({ type: String, format: "uuid" }) id!: string;
  @ApiProperty({ type: String, enum: ["steam_refill", "coins_top_up"] }) kind!: "steam_refill" | "coins_top_up";
  @ApiProperty({ type: String, enum: paymentStatuses }) status!: typeof paymentStatuses[number];
  @ApiProperty({ type: "integer", minimum: 1 }) amountMinor!: number;
  @ApiProperty({ type: String, enum: ["RUB"] }) currency!: "RUB";
  @ApiProperty({ type: String, format: "uuid", nullable: true }) orderId!: string | null;
  @ApiProperty({ type: String, enum: fulfillmentStatuses, nullable: true }) fulfillmentStatus!: typeof fulfillmentStatuses[number] | null;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: string;
}

export class PaymentHistoryDto {
  @ApiProperty({ type: [PaymentHistoryItemDto] }) payments!: PaymentHistoryItemDto[];
}
