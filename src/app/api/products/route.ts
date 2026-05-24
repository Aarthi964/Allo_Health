import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const products = await prisma.product.findMany({
      include: {
        inventories: {
          include: {
            warehouse: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    const formattedProducts = products.map((product) => ({
      id: product.id,
      name: product.name,
      description: product.description,
      createdAt: product.createdAt,
      inventories: product.inventories.map((inv) => ({
        id: inv.id,
        productId: inv.productId,
        warehouseId: inv.warehouseId,
        totalStock: inv.totalStock,
        reservedStock: inv.reservedStock,
        availableStock: Math.max(0, inv.totalStock - inv.reservedStock),
        updatedAt: inv.updatedAt,
        warehouse: {
          id: inv.warehouse.id,
          name: inv.warehouse.name,
          location: inv.warehouse.location,
        },
      })),
    }));

    return NextResponse.json({ products: formattedProducts });
  } catch (error) {
    console.error('Error fetching products:', error);
    return NextResponse.json({ error: 'Failed to fetch products' }, { status: 500 });
  }
}
