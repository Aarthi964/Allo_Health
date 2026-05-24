import { NextRequest, NextResponse } from 'next/server';
import { createReservationSchema } from '@/validators/reservation';
import { ReservationService, ReservationError } from '@/services/reservationService';

export async function POST(req: NextRequest) {
  try {
    const idempotencyKey = req.headers.get('Idempotency-Key') || undefined;

    const body = await req.json().catch(() => ({}));
    
    // Validate inputs using Zod
    const validation = createReservationSchema.safeParse(body);
    
    if (!validation.success) {
      const errors = validation.error.flatten().fieldErrors;
      return NextResponse.json(
        { error: 'Validation failed', details: errors },
        { status: 400 }
      );
    }

    const { productId, warehouseId, quantity } = validation.data;

    // Call reservation service (concurrency safe)
    const reservation = await ReservationService.reserveStock(
      productId,
      warehouseId,
      quantity,
      idempotencyKey
    );

    return NextResponse.json(reservation, { status: 201 });
  } catch (error) {
    if (error instanceof ReservationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }

    console.error('Reservation creation error:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred during reservation.' },
      { status: 500 }
    );
  }
}
