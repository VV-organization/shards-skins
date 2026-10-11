import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseService } from '../../common/database/database.service';
import { normalizeIdempotencyKey } from '../../common/idempotency/idempotency-key';
import { CatalogService } from '../catalog/catalog.service';
import type { CatalogProductDto } from '../catalog/catalog.types';

export type CartClient = Pick<DatabaseService, 'query'>;
export type LockedCart = { id: string; version: number };
export type CartRecipient = { steamLogin?: string };
export type CartItemDto = {
  productId: string; productSlug: string; kind: CatalogProductDto['kind']; title: string;
  quantity: number; unitPriceCoinMinor: number; lineTotalCoinMinor: number;
  recipient: CartRecipient; product: CatalogProductDto;
  availability: 'available' | 'unavailable' | 'price_changed';
};
export type CartDto = { version: number; items: CartItemDto[]; totalCoinMinor: number; canCheckout: boolean };
export type CartCommand = { userId: string; expectedCartVersion: number; idempotencyKey: string };
export type SetCartItemCommand = CartCommand & { productSlug: string; quantity: number; recipient?: CartRecipient };

@Injectable()
export class CartService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}

  async lockCart(client: CartClient, userId: string): Promise<LockedCart> {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`cart:${userId}`]);
    const result = await client.query<LockedCart>(`INSERT INTO carts(user_id,status) VALUES ($1,'active')
      ON CONFLICT(user_id,status) DO UPDATE SET updated_at=carts.updated_at RETURNING id,version`, [userId]);
    const cart = result.rows[0];
    if (!cart) throw new Error("CART_NOT_CREATED");
    return cart;
  }

  async getCart(userId: string): Promise<CartDto> {
    return this.database.transaction(async client => this.readCart(client, await this.lockCart(client, userId)));
  }

  /** Replay precedes version validation. All mutations and their durable response commit together. */
  async mutate(command: CartCommand, payload: unknown,
    change: (client: CartClient, cart: LockedCart, operationId: string) => Promise<boolean>): Promise<CartDto> {
    let key: string | undefined;
    try { key = normalizeIdempotencyKey(command.idempotencyKey); }
    catch { throw new BadRequestException('Invalid idempotency key'); }
    if (!key || !Number.isSafeInteger(command.expectedCartVersion) || command.expectedCartVersion < 0) {
      throw new BadRequestException('Cart version and idempotency key are required');
    }
    const hash = createHash('sha256').update(JSON.stringify([command.expectedCartVersion, payload])).digest('hex');
    return this.database.transaction(async client => {
      const cart = await this.lockCart(client, command.userId);
      const prior = await client.query<{ request_hash: string; response: CartDto }>(
        'SELECT request_hash,response FROM cart_commands WHERE user_id=$1 AND idempotency_key=$2', [command.userId, key]);
      if (prior.rows[0]) {
        if (prior.rows[0].request_hash !== hash) throw new ConflictException('IDEMPOTENCY_KEY_REUSED');
        return prior.rows[0].response;
      }
      if (cart.version !== command.expectedCartVersion) throw new ConflictException('CART_VERSION_CHANGED');
      const operationId = randomUUID();
      if (await change(client, cart, operationId)) {
        await client.query('UPDATE carts SET version=version+1,updated_at=clock_timestamp() WHERE id=$1', [cart.id]);
        cart.version++;
      }
      const response = await this.readCart(client, cart);
      await client.query(`INSERT INTO cart_commands(id,user_id,idempotency_key,request_hash,response) VALUES ($1,$2,$3,$4,$5::jsonb)`,
        [operationId, command.userId, key, hash, JSON.stringify(response)]);
      return response;
    });
  }

  async addProducts(client: CartClient, cart: LockedCart, products: CatalogProductDto[]): Promise<boolean> {
    if (products.some(p => p.kind !== 'skins' || p.availability !== 'available')) throw new BadRequestException('PRODUCT_UNAVAILABLE');
    const existing = await client.query<{ product_slug: string }>('SELECT product_slug FROM cart_items WHERE cart_id=$1', [cart.id]);
    const slugs = new Set(existing.rows.map(row => row.product_slug));
    const additions = products.filter(p => { if (slugs.has(p.slug)) return false; slugs.add(p.slug); return true; });
    if (slugs.size > 50) throw new BadRequestException('CART_LIMIT_REACHED');
    for (const product of additions) await client.query(`INSERT INTO cart_items(cart_id,product_slug,quantity,recipient,product_snapshot)
      VALUES ($1,$2,1,'{}',$3::jsonb)`, [cart.id, product.slug, JSON.stringify(product)]);
    return additions.length > 0;
  }

  setItem(command: SetCartItemCommand): Promise<CartDto> {
    if (command.quantity !== 1 || command.recipient?.steamLogin) throw new BadRequestException('Skins cart supports one item per SKU');
    return this.mutate(command, ['add', command.productSlug, 1], async (client, cart) => {
      const product = await this.catalog.getBySlug(command.productSlug, client);
      return this.addProducts(client, cart, [product]);
    });
  }

  removeItem(command: CartCommand & { productSlug: string }): Promise<CartDto> {
    return this.mutate(command, ['remove', command.productSlug], async (client, cart) => {
      const result = await client.query('DELETE FROM cart_items WHERE cart_id=$1 AND product_slug=$2', [cart.id, command.productSlug]);
      return (result.rowCount ?? 0) > 0;
    });
  }

  clearCart(command: CartCommand): Promise<CartDto> {
    return this.mutate(command, ['clear'], async (client, cart) => {
      const result = await client.query('DELETE FROM cart_items WHERE cart_id=$1', [cart.id]);
      return (result.rowCount ?? 0) > 0;
    });
  }

  async readCart(client: CartClient, cart: LockedCart): Promise<CartDto> {
    const rows = await client.query<{ product_slug: string; product_snapshot: CatalogProductDto }>(
      'SELECT product_slug,product_snapshot FROM cart_items WHERE cart_id=$1 ORDER BY created_at,id', [cart.id]);
    const current = rows.rows.length ? (await this.catalog.lookup(rows.rows.map(row => row.product_slug), client)).items : [];
    const bySlug = new Map(current.map(product => [product.slug, product]));
    const items: CartItemDto[] = rows.rows.map(row => {
      const live = bySlug.get(row.product_slug);
      const product = live ?? { ...row.product_snapshot, availability: 'unavailable' as const };
      const availability = product.availability !== 'available' ? 'unavailable'
        : product.priceRevision !== row.product_snapshot.priceRevision ? 'price_changed' : 'available';
      return { productId: product.id, productSlug: row.product_slug, kind: product.kind, title: product.title,
        quantity: 1, unitPriceCoinMinor: product.price.amountMinor, lineTotalCoinMinor: product.price.amountMinor,
        recipient: {}, product, availability };
    });
    return { version: cart.version, items, totalCoinMinor: items.reduce((sum, item) => sum + item.lineTotalCoinMinor, 0),
      canCheckout: items.length > 0 && items.every(item => item.availability !== 'unavailable') };
  }

}
