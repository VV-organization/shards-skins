/** Fail closed until named provider contracts, server sessions and a durable ledger are connected. */
export function unavailablePurchase(){return {status:409,body:{code:"INTEGRATION_UNAVAILABLE",error:"Не удалось оформить покупку. Заказ не создан, деньги не списаны."}} as const;}
export function unavailableTopup(kind:"balance"|"steam"){return {status:409,body:{code:"INTEGRATION_UNAVAILABLE",error:kind==="steam"?"Пополнение Steam временно недоступно. Деньги не списаны.":"Пополнение баланса временно недоступно. Баланс не изменён."}} as const;}
