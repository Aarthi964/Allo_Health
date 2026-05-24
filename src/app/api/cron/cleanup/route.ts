import { NextRequest, NextResponse } from 'next/server';
import { ReservationService } from '@/services/reservationService';

export async function POST(req: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;

    // Check for authorization via Header or Query String
    const authHeader = req.headers.get('Authorization');
    const url = new URL(req.url);
    const querySecret = url.searchParams.get('secret');

    const providedSecret = authHeader
      ? authHeader.replace('Bearer ', '').trim()
      : querySecret?.trim();

    if (!cronSecret || providedSecret !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Call batched cleanup
    const result = await ReservationService.cleanupExpiredReservations(100);

    return NextResponse.json({
      success: true,
      message: 'Cleanup completed successfully.',
      ...result,
    }, { status: 200 });
  } catch (error) {
    console.error('Cron cleanup execution error:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred during cleanup execution.' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
