import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: 'Reservation ID is required' }, { status: 400 });
    }

    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: {
        product: true,
        warehouse: true,
      },
    });

    if (!reservation) {
      return NextResponse.json({ error: 'Reservation not found' }, { status: 404 });
    }

    return NextResponse.json({
      id: reservation.id,
      productId: reservation.productId,
      warehouseId: reservation.warehouseId,
      quantity: reservation.quantity,
      status: reservation.status,
      expiresAt: reservation.expiresAt,
      createdAt: reservation.createdAt,
      product: {
        id: reservation.product.id,
        name: reservation.product.name,
        description: reservation.product.description,
      },
      warehouse: {
        id: reservation.warehouse.id,
        name: reservation.warehouse.name,
        location: reservation.warehouse.location,
      },
    });
  } catch (error) {
    console.error('Error fetching reservation details:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred while fetching reservation details.' },
      { status: 500 }
    );
  }
}
