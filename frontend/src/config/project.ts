export const project = {
  name:"Shards",
  shardsPerRuble:1.6,
  rateVersion:"shards-8-5-v1",
  steamFeePercent:5,
  preview: process.env.NEXT_PUBLIC_CATALOG_MODE !== "live",
} as const;
