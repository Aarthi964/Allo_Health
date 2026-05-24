import { NextRequest, NextResponse } from 'next/server';
import { ReservationService, ReservationError } from '@/services/reservationService';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: 'Reservation ID is required' }, { status: 400 });
    }

    const confirmed = await ReservationService.confirmReservation(id);
    return NextResponse.json(confirmed, { status: 200 });
  } catch (error) {
    if (error instanceof ReservationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }

    console.error('Reservation confirmation error:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred during confirmation.' },
      { status: 500 }
    );
  }
}
