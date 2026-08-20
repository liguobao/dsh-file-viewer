// Fruit Store — 库存服务（TypeScript 示例）
import { EventEmitter } from 'node:events'

export interface Product {
  id: number
  name: string
  price: number
  stock: number
  category: 'fruit' | 'vegetable' | 'imported'
}

export class InventoryService extends EventEmitter {
  private products = new Map<number, Product>()
  private threshold = 100

  constructor(private readonly minStock = 20) {
    super()
  }

  /** 添加或更新商品库存 */
  upsert(product: Product): void {
    const previous = this.products.get(product.id)
    this.products.set(product.id, product)
    if (previous !== undefined && previous.stock > this.minStock && product.stock <= this.minStock) {
      this.emit('low-stock', { product, remaining: product.stock })
    }
  }

  /** 检查库存是否充足 */
  isAvailable(id: number, qty: number): boolean {
    return (this.products.get(id)?.stock ?? 0) >= qty
  }

  /** 盘点：返回所有低于阈值的商品 */
  audit(): Array<{ product: Product; shortfall: number }> {
    const result: Array<{ product: Product; shortfall: number }> = []
    for (const product of this.products.values()) {
      if (product.stock < this.threshold) {
        result.push({ product, shortfall: this.threshold - product.stock })
      }
    }
    return result
  }
}

export async function reorder(svc: InventoryService, id: number, qty: number): Promise<boolean> {
  const product = svc.audit().find(({ product: p }) => p.id === id)
  if (product === undefined) return false
  svc.upsert({ ...product.product, stock: product.product.stock + qty })
  return true
}
