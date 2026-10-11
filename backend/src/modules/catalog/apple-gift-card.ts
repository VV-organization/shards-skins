import type { CatalogFulfillmentDetails, CatalogProductSpecification } from "./catalog.types";

export type AppleGiftCardDetails = {
  fulfillment: CatalogFulfillmentDetails;
  appleGiftCard: {
    currency: string;
    nominalMinor: number;
    regionCode: string;
    regionLabel: string;
  };
  specifications: CatalogProductSpecification[];
};

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFulfillmentDetails(value: unknown): value is CatalogFulfillmentDetails {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CatalogFulfillmentDetails>;
  return hasNonEmptyString(candidate.title)
    && hasNonEmptyString(candidate.description)
    && Array.isArray(candidate.requirements)
    && candidate.requirements.every(hasNonEmptyString);
}

export function parseAppleGiftCardDetails(value: unknown): AppleGiftCardDetails | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<AppleGiftCardDetails>;
  const card = candidate.appleGiftCard;
  if (
    !isFulfillmentDetails(candidate.fulfillment)
    || typeof card !== "object"
    || !hasNonEmptyString(card.currency)
    || !Number.isSafeInteger(card.nominalMinor)
    || card.nominalMinor <= 0
    || !hasNonEmptyString(card.regionCode)
    || !hasNonEmptyString(card.regionLabel)
    || !Array.isArray(candidate.specifications)
  ) {
    return null;
  }
  if (!candidate.specifications.every((specification) => (
    typeof specification === "object"
    && hasNonEmptyString(specification.label)
    && hasNonEmptyString(specification.value)
  ))) return null;
  return {
    fulfillment: candidate.fulfillment,
    appleGiftCard: {
      currency: card.currency.trim().toUpperCase(),
      nominalMinor: card.nominalMinor,
      regionCode: card.regionCode.trim().toUpperCase(),
      regionLabel: card.regionLabel.trim(),
    },
    specifications: candidate.specifications,
  };
}
