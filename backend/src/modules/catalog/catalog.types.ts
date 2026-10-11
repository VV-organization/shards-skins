export type CatalogProductKind = "steam" | "skins" | "apple_gift_card";
export type CatalogAvailability = "available" | "on-request";
export type CatalogFulfillmentMode = "automatic" | "steam-trade" | "manual";
export type CatalogSort = "relevance" | "price_asc" | "price_desc" | "newest" | "name_asc" | "name_desc";

export type CatalogProductSpecification = {
  label: string;
  value: string;
};

export type CatalogFulfillmentDetails = {
  title: string;
  description: string;
  requirements: string[];
};

export type CatalogProductDetails = {
  specifications: CatalogProductSpecification[];
  fulfillment: CatalogFulfillmentDetails;
  appleGiftCard?: {
    currency: string;
    nominalMinor: number;
    regionCode: string;
    regionLabel: string;
  };
};

export type CatalogProduct = {
  id: string;
  slug: string;
  kind: CatalogProductKind;
  category: string;
  game?: string;
  productType: string;
  title: string;
  description: string;
  priceCoins: number;
  availability: CatalogAvailability;
  fulfillmentMode: CatalogFulfillmentMode;
  createdAt: string;
  popularity: number;
  image?: string;
  imageAlt?: string;
  meta: string[];
  keywords: string[];
  details: CatalogProductDetails;
};

export type CoinPriceDto = {
  currency: "COINS";
  amountMinor: number;
  scale: 2;
  display: string;
};

export type CatalogProductDto = Omit<CatalogProduct, "priceCoins"> & {
  price: CoinPriceDto;
};

export type CatalogFacetOption = {
  id: string;
  title: string;
};

export type CatalogFacetsDto = {
  kinds: CatalogFacetOption[];
  games: CatalogFacetOption[];
  productTypes: CatalogFacetOption[];
  conditions: CatalogFacetOption[];
  fulfillmentModes: CatalogFacetOption[];
  availability: CatalogFacetOption[];
};

export type CatalogListDto = {
  items: CatalogProductDto[];
  facets: CatalogFacetsDto;
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
  };
  pricing: {
    coinRate: {
      fiatCurrency: "RUB";
      fiatMinor: 100;
      coinMinor: 150;
      display: string;
    };
  };
};

export type CatalogListQuery = {
  q?: string;
  category?: string;
  game?: string;
  condition?: string | string[];
  status?: string | string[];
  type?: string | string[];
  fulfillment?: string | string[];
  weapon?: string | string[];
  min?: string;
  max?: string;
  sort?: string;
  limit?: string;
  offset?: string;
};
