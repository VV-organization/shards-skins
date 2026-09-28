export const project = {
  name:"Shards",
  shardsPerRuble:1.6,
  steamFeePercent:5,
  preview: process.env.NEXT_PUBLIC_CATALOG_MODE !== "live",
} as const;
