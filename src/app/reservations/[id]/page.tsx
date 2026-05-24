'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';

interface Reservation {
  id: string;
  productId: string;
  warehouseId: string;
  quantity: number;
  status: 'PENDING' | 'CONFIRMED' | 'RELEASED';
  expiresAt: string;
  createdAt: string;
  product: {
    name: string;
    description: string;
  };
  warehouse: {
    name: string;
    location: string;
  };
}

export default function ReservationPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id } = use(params);

  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Countdown state
  const [timeLeft, setTimeLeft] = useState<string>('10:00');
  const [isExpired, setIsExpired] = useState(false);

  // Button actions loading state
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    fetchReservationDetails();
  }, [id]);

  useEffect(() => {
    if (!reservation || reservation.status !== 'PENDING') return;

    const expiresTime = new Date(reservation.expiresAt).getTime();

    const updateTimer = () => {
      const now = Date.now();
      const diff = expiresTime - now;

      if (diff <= 0) {
        setIsExpired(true);
        setTimeLeft('00:00');
        // Update local state status to reflect expiration
        setReservation((prev) => prev ? { ...prev, status: 'RELEASED' } : null);
        clearInterval(timer);
      } else {
        const totalSecs = Math.floor(diff / 1000);
        const mins = Math.floor(totalSecs / 60);
        const secs = totalSecs % 60;
        setTimeLeft(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
      }
    };

    // Run once immediately
    updateTimer();

    const timer = setInterval(updateTimer, 1000);
    return () => clearInterval(timer);
  }, [reservation]);

  const fetchReservationDetails = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reservations/${id}`);
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error('Reservation not found.');
        }
        throw new Error('Failed to load reservation details.');
      }
      const data = await res.json();
      setReservation(data);

      // Check if already expired on load
      const isPast = new Date(data.expiresAt).getTime() < Date.now();
      if (isPast || data.status === 'RELEASED') {
        setIsExpired(true);
        setTimeLeft('00:00');
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!reservation) return;
    setActionLoading('confirm');
    setActionError(null);

    try {
      const res = await fetch(`/api/reservations/${reservation.id}/confirm`, {
        method: 'POST',
      });
      const data = await res.json();

      if (!res.ok) {
        if (res.status === 410) {
          setIsExpired(true);
          setReservation((prev) => prev ? { ...prev, status: 'RELEASED' } : null);
          throw new Error('Reservation expired');
        }
        throw new Error(data.error || 'Failed to confirm purchase.');
      }

      // Successful confirmation: Optimistic update
      setReservation((prev) => prev ? { ...prev, status: 'CONFIRMED' } : null);
    } catch (err: any) {
      setActionError(err.message || 'Could not confirm reservation.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async () => {
    if (!reservation) return;
    setActionLoading('cancel');
    setActionError(null);

    try {
      const res = await fetch(`/api/reservations/${reservation.id}/release`, {
        method: 'POST',
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to cancel reservation.');
      }

      // Successful cancel: Optimistic update
      setReservation((prev) => prev ? { ...prev, status: 'RELEASED' } : null);
    } catch (err: any) {
      setActionError(err.message || 'Could not cancel reservation.');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="flex-1 bg-slate-950 text-slate-100 min-h-screen py-10 px-4 flex flex-col justify-center items-center">
      {/* Loading Skeleton */}
      {loading && (
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl p-8 animate-pulse text-center">
          <div className="w-16 h-16 bg-slate-800 rounded-full mx-auto mb-6"></div>
          <div className="h-6 bg-slate-800 rounded w-3/4 mx-auto mb-4"></div>
          <div className="h-4 bg-slate-800 rounded w-1/2 mx-auto mb-6"></div>
          <div className="h-10 bg-slate-800 rounded w-full"></div>
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl p-8 text-center shadow-2xl">
          <div className="w-12 h-12 bg-red-950 border border-red-800 rounded-full flex items-center justify-center mx-auto mb-4 text-red-400 font-bold text-xl">
            !
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Error</h2>
          <p className="text-slate-400 text-sm mb-6">{error}</p>
          <button
            onClick={() => router.push('/')}
            className="w-full bg-slate-800 hover:bg-slate-700 text-white font-medium rounded-lg py-2.5 transition"
          >
            Back to Products
          </button>
        </div>
      )}

      {/* Main Reservation UI */}
      {!loading && !error && reservation && (
        <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 md:p-8 shadow-2xl shadow-slate-950/80">
          
          {/* Status and Countdown Header */}
          <div className="text-center border-b border-slate-800 pb-6 mb-6">
            {reservation.status === 'PENDING' && (
              <>
                <div className="text-5xl font-mono font-bold tracking-widest text-cyan-400 mb-2 drop-shadow-[0_0_8px_rgba(34,211,238,0.2)]">
                  {timeLeft}
                </div>
                <p className="text-xs uppercase font-semibold text-slate-400 tracking-widest">
                  Hold Time Remaining
                </p>
              </>
            )}

            {reservation.status === 'CONFIRMED' && (
              <div className="flex flex-col items-center">
                <div className="w-12 h-12 bg-emerald-950 border border-emerald-800 rounded-full flex items-center justify-center mb-3 text-emerald-400 font-bold text-lg">
                  ✓
                </div>
                <h2 className="text-2xl font-extrabold text-white">Purchase Confirmed</h2>
                <p className="text-xs text-slate-400 mt-1">Inventory has been permanently decremented</p>
              </div>
            )}

            {reservation.status === 'RELEASED' && (
              <div className="flex flex-col items-center">
                <div className="w-12 h-12 bg-red-950 border border-red-800 rounded-full flex items-center justify-center mb-3 text-red-400 font-bold text-lg">
                  ✕
                </div>
                <h2 className="text-2xl font-extrabold text-white">
                  {isExpired ? 'Reservation Expired' : 'Reservation Cancelled'}
                </h2>
                <p className="text-xs text-slate-400 mt-1">Stock has been released back to inventory</p>
              </div>
            )}
          </div>

          {/* Reservation details */}
          <div className="space-y-4 mb-6">
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Item Summary
            </h3>
            
            <div className="bg-slate-950 rounded-xl p-4 border border-slate-800/60 divide-y divide-slate-800/40">
              <div className="py-2.5 flex items-center justify-between text-sm">
                <span className="text-slate-400">Product</span>
                <span className="text-white font-medium text-right max-w-[240px] truncate">
                  {reservation.product.name}
                </span>
              </div>
              <div className="py-2.5 flex items-center justify-between text-sm">
                <span className="text-slate-400">Warehouse</span>
                <span className="text-white font-medium text-right">
                  {reservation.warehouse.name}
                </span>
              </div>
              <div className="py-2.5 flex items-center justify-between text-sm">
                <span className="text-slate-400">Reserved Quantity</span>
                <span className="text-cyan-400 font-bold">{reservation.quantity} units</span>
              </div>
              <div className="py-2.5 flex items-center justify-between text-sm">
                <span className="text-slate-400">Status</span>
                <span
                  className={`text-xs font-bold uppercase px-2 py-0.5 rounded ${
                    reservation.status === 'PENDING'
                      ? 'bg-cyan-950 text-cyan-400 border border-cyan-800'
                      : reservation.status === 'CONFIRMED'
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                      : 'bg-red-950 text-red-400 border border-red-800'
                  }`}
                >
                  {reservation.status}
                </span>
              </div>
            </div>
          </div>

          {/* Action Error display */}
          {actionError && (
            <div className="mb-6 bg-red-950/40 border border-red-900/50 rounded-xl p-4 text-xs text-red-400 flex flex-col gap-1">
              <span className="font-semibold uppercase tracking-wider text-[10px]">Action Failed</span>
              <span>{actionError}</span>
            </div>
          )}

          {/* Buttons */}
          <div className="space-y-3">
            {reservation.status === 'PENDING' && (
              <div className="flex gap-4">
                {/* Cancel Button */}
                <button
                  onClick={handleCancel}
                  disabled={actionLoading !== null}
                  className="flex-1 bg-slate-950 hover:bg-slate-800 text-slate-200 border border-slate-800 font-semibold py-3 px-4 rounded-lg disabled:opacity-40 transition-colors"
                >
                  {actionLoading === 'cancel' ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-slate-200 border-t-transparent rounded-full animate-spin"></span>
                      Cancelling...
                    </span>
                  ) : (
                    'Cancel'
                  )}
                </button>

                {/* Confirm Button */}
                <button
                  onClick={handleConfirm}
                  disabled={actionLoading !== null}
                  className="flex-1 bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-slate-950 font-bold py-3 px-4 rounded-lg disabled:opacity-40 transition-all duration-200"
                >
                  {actionLoading === 'confirm' ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></span>
                      Confirming...
                    </span>
                  ) : (
                    'Confirm Checkout'
                  )}
                </button>
              </div>
            )}

            {/* Back Button for completed statuses */}
            {reservation.status !== 'PENDING' && (
              <button
                onClick={() => router.push('/')}
                className="w-full bg-slate-950 hover:bg-slate-850 text-slate-200 border border-slate-800 font-semibold py-3 px-4 rounded-lg transition-colors"
              >
                Back to Product List
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
