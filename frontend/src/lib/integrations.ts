/** Fail closed until named provider contracts, server sessions and a durable ledger are connected. */
export function unavailablePurchase(){return {status:409,body:{code:"INTEGRATION_UNAVAILABLE",error:"Не удалось оформить покупку. Заказ не создан, деньги не списаны."}} as const;}
export function unavailableTopup(kind:"balance"|"steam"){return {status:409,body:{code:"INTEGRATION_UNAVAILABLE",error:kind==="steam"?"Пополнение не выполнено. Деньги не списаны.":"Пополнение не выполнено. Баланс не изменён."}} as const;}
