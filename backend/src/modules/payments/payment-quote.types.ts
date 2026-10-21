export type PaymentPurpose='wallet_topup'|'steam_refill';
export type PaymentTerms={purpose:PaymentPurpose;termsVersion:string;environment:string;fiatAmountMinor:number;currency:'RUB';coinAmountMinor?:number;amountRub?:number;feeRubMinor?:number;steamLogin?:string;contactEmail?:string;contactEmailSource?:'input';guestCheckout?:boolean;steamCheckTransactionId?:string};
export type PaymentQuoteDto=PaymentTerms&{quoteId:string;expiresAt:string};
export type PaymentQuoteBinding={quoteId:string;acceptedFiatMinor:number};
export const WALLET_TERMS_VERSION='shards-wallet-160-v1';
export const STEAM_TERMS_VERSION='steam-rub-500-v1';
