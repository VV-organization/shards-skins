export const project = {
  name:"PRISM",
  rublesPerPrism:1.5,
  steamFeePercent:5,
  preview: process.env.NEXT_PUBLIC_CATALOG_MODE !== "live",
} as const;
