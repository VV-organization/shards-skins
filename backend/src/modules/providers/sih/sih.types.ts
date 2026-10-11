export type SihCatalogGame = "cs2" | "rust" | "tf2";

export type SihSupplierItem = {
  availableQuantity: number;
  game: SihCatalogGame;
  imageUrl: string | null;
  marketHashName: string;
  priceMicrousd: bigint;
};

export type SihSkinOrderStatus = "created" | "processing" | "sent" | "finished" | "failed" | "penalized";

export type SihSkinProtection = {
  error: "rollback user" | "rollback supplier" | null;
  rollbackAmountMicrousd: bigint | null;
  rollbackAt: Date | null;
  status: "processing" | "finished" | "failed";
};

export type SihSkinOrder = {
  amountMicrousd: bigint;
  customId: string;
  expectedAmountMicrousd: bigint | null;
  marketHashName: string;
  offerId: string | null;
  projection: "order";
  protection: SihSkinProtection | null;
  providerOrderId: string;
  status: SihSkinOrderStatus;
  steamId64: string;
};

export type SihCreateSkinOrderResult =
  | {
    projection: "create_acknowledgement";
    providerBalanceMicrousd: bigint | null;
    providerOrderId: string;
  }
  | SihSkinOrder;

export type SihSteamCheckResult = {
  transactionId: string;
};

export type SihSteamPayResult = {
  cashbackUsd: bigint;
  paymentAmountRub: bigint;
  status: "success";
};

export type SihFailureDisposition = "permanent" | "retryable";
