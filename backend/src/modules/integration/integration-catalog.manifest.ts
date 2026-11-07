/** Read-only source for invoices; supplier-managed stock cannot be edited by VV Admin. */
export function invoiceCatalogCapability(adminOrigin: string) {
  const readOnly = { version: 1, create: false, update: false, delete: false } as const;
  return {
    managementEnabled: false,
    pagination: { pageSize: 200 },
    baseUrl: `${adminOrigin}/admin/integration/catalog`,
    auth: { scheme: "vv_hmac" },
    locales: ["ru-RU"],
    categories: {
      enabled: false, maxDepth: 1, fields: ["name"],
      deletion: { mode: "blocked_by_references", dryRun: false },
    },
    resources: {
      products: {
        enabled: true, categoryRequired: false, write: readOnly,
        schema: {
          type: "object", additionalProperties: false,
          properties: { publicUrl: { type: "string", format: "uri" }, game: { type: "string", enum: ["cs2"] } },
          required: ["publicUrl", "game"],
        },
      },
      offers: {
        enabled: true, requiredForPurchasableProduct: true, write: readOnly,
        schema: { type: "object", additionalProperties: false, properties: {} },
      },
      destinations: { enabled: false, orderedProductMembership: false },
      sellers: { enabled: false, mode: "none" },
      collections: { enabled: false },
    },
    media: { mode: "url", maxBytes: 0, mimeTypes: ["image/png", "image/jpeg", "image/webp"] },
  } as const;
}
