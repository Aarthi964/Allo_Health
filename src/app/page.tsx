'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Warehouse {
  id: string;
  name: string;
  location: string;
}

interface Inventory {
  id: string;
  productId: string;
  warehouseId: string;
  totalStock: number;
  reservedStock: number;
  availableStock: number;
  warehouse: Warehouse;
}

interface Product {
  id: string;
  name: string;
  description: string;
  inventories: Inventory[];
}

export default function ProductListingPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // State for warehouse selection and quantity selection per product
  const [selections, setSelections] = useState<Record<string, { warehouseId: string; quantity: number }>>({});
  const [reserving, setReserving] = useState<Record<string, boolean>>({});
  const [apiError, setApiError] = useState<Record<string, string | null>>({});

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/products');
      if (!res.ok) {
        throw new Error('Failed to load products');
      }
      const data = await res.json();
      setProducts(data.products || []);
      
      // Initialize default selections: first warehouse, quantity 1
      const initialSelections: Record<string, { warehouseId: string; quantity: number }> = {};
      data.products.forEach((product: Product) => {
        if (product.inventories && product.inventories.length > 0) {
          initialSelections[product.id] = {
            warehouseId: product.inventories[0].warehouseId,
            quantity: 1,
          };
        }
      });
      setSelections(initialSelections);
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const handleWarehouseChange = (productId: string, warehouseId: string) => {
    setSelections((prev) => ({
      ...prev,
      [productId]: {
        ...prev[productId],
        warehouseId,
      },
    }));
    // Clear old errors on change
    setApiError((prev) => ({ ...prev, [productId]: null }));
  };

  const handleQuantityChange = (productId: string, quantity: number) => {
    const val = Math.max(1, Math.min(100, quantity));
    setSelections((prev) => ({
      ...prev,
      [productId]: {
        ...prev[productId],
        quantity: val,
      },
    }));
    // Clear old errors on change
    setApiError((prev) => ({ ...prev, [productId]: null }));
  };

  const handleReserve = async (productId: string) => {
    const selection = selections[productId];
    if (!selection) return;

    setReserving((prev) => ({ ...prev, [productId]: true }));
    setApiError((prev) => ({ ...prev, [productId]: null }));

    // Generate a unique idempotency key for this reservation attempt
    const idempotencyKey = crypto.randomUUID();

    try {
      const res = await fetch('/api/reservations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          productId,
          warehouseId: selection.warehouseId,
          quantity: selection.quantity,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to reserve stock.');
      }

      // Success: Redirect to the reservation checkout page
      router.push(`/reservations/${data.id}`);
    } catch (err: any) {
      setApiError((prev) => ({
        ...prev,
        [productId]: err.message || 'Failed to create reservation.',
      }));
    } finally {
      setReserving((prev) => ({ ...prev, [productId]: false }));
    }
  };

  return (
    <div className="flex-1 bg-slate-950 text-slate-100 min-h-screen py-10 px-4 md:px-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <header className="flex flex-col md:flex-row items-start md:items-center justify-between border-b border-slate-800 pb-6 mb-10">
          <div>
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-white bg-gradient-to-r from-emerald-400 to-cyan-500 bg-clip-text text-transparent">
              Allo Inventory
            </h1>
            <p className="text-slate-400 mt-2">
              Production-Grade Concurrency-Safe Stock Reservation System
            </p>
          </div>
          <div className="mt-4 md:mt-0 flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-full px-4 py-1.5 text-xs text-slate-300">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            System Online
          </div>
        </header>

        {/* Loading state */}
        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((n) => (
              <div key={n} className="bg-slate-900 border border-slate-800 rounded-xl p-6 animate-pulse">
                <div className="h-6 bg-slate-800 rounded w-2/3 mb-4"></div>
                <div className="h-4 bg-slate-800 rounded w-full mb-2"></div>
                <div className="h-4 bg-slate-800 rounded w-5/6 mb-6"></div>
                <div className="h-10 bg-slate-800 rounded w-full"></div>
              </div>
            ))}
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="bg-red-950 border border-red-800 rounded-xl p-6 text-center max-w-md mx-auto">
            <h3 className="text-lg font-semibold text-red-400 mb-2">Failed to load inventory</h3>
            <p className="text-slate-400 text-sm mb-4">{error}</p>
            <button
              onClick={fetchProducts}
              className="bg-red-800 hover:bg-red-700 text-white font-medium rounded-lg px-4 py-2 text-sm transition"
            >
              Retry Connection
            </button>
          </div>
        )}

        {/* Product Grid */}
        {!loading && !error && products.length === 0 && (
          <div className="text-center py-20 text-slate-400 border border-dashed border-slate-800 rounded-xl">
            <p className="text-lg mb-2">No products found in the database.</p>
            <p className="text-sm text-slate-500">Run the database seed script to populate sample items.</p>
          </div>
        )}

        {!loading && !error && products.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {products.map((product) => {
              const selection = selections[product.id] || { warehouseId: '', quantity: 1 };
              const currentInventory = product.inventories.find(
                (inv) => inv.warehouseId === selection.warehouseId
              );
              const availableStock = currentInventory ? currentInventory.availableStock : 0;
              const isOutOfStock = availableStock <= 0;
              const isBtnDisabled = isOutOfStock || reserving[product.id];
              const pError = apiError[product.id];

              return (
                <div
                  key={product.id}
                  className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl p-6 flex flex-col justify-between transition-all duration-250 shadow-lg shadow-slate-950/50"
                >
                  <div>
                    {/* Title & Description */}
                    <h3 className="text-lg font-bold text-white mb-2">{product.name}</h3>
                    <p className="text-sm text-slate-400 mb-6 min-h-[40px] line-clamp-2">
                      {product.description}
                    </p>

                    {/* Warehouse Dropdown */}
                    <div className="mb-4">
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                        Select Warehouse
                      </label>
                      <select
                        value={selection.warehouseId}
                        onChange={(e) => handleWarehouseChange(product.id, e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 text-slate-200 text-sm rounded-lg p-2.5 outline-none focus:border-cyan-500 transition-colors"
                      >
                        {product.inventories.map((inv) => (
                          <option key={inv.warehouseId} value={inv.warehouseId}>
                            {inv.warehouse.name} ({inv.warehouse.location})
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Stock Status Badge */}
                    <div className="flex items-center justify-between mb-6 bg-slate-950/60 rounded-lg p-3 border border-slate-800/50">
                      <span className="text-xs text-slate-400">Available Stock:</span>
                      <span
                        className={`text-sm font-bold ${
                          isOutOfStock ? 'text-red-400' : 'text-emerald-400'
                        }`}
                      >
                        {isOutOfStock ? 'OUT OF STOCK' : `${availableStock} units`}
                      </span>
                    </div>

                    {/* Quantity Selector */}
                    <div className="mb-6">
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                        Quantity to Reserve
                      </label>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => handleQuantityChange(product.id, selection.quantity - 1)}
                          disabled={selection.quantity <= 1 || isOutOfStock}
                          className="bg-slate-950 hover:bg-slate-800 border border-slate-800 disabled:opacity-40 w-10 h-10 rounded-lg font-bold flex items-center justify-center transition-colors"
                        >
                          -
                        </button>
                        <input
                          type="number"
                          value={selection.quantity}
                          onChange={(e) => handleQuantityChange(product.id, parseInt(e.target.value) || 1)}
                          disabled={isOutOfStock}
                          min={1}
                          max={100}
                          className="bg-slate-950 border border-slate-800 text-center w-16 h-10 rounded-lg outline-none text-white focus:border-cyan-500 transition-colors font-medium [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <button
                          onClick={() => handleQuantityChange(product.id, selection.quantity + 1)}
                          disabled={selection.quantity >= availableStock || isOutOfStock || selection.quantity >= 100}
                          className="bg-slate-950 hover:bg-slate-800 border border-slate-800 disabled:opacity-40 w-10 h-10 rounded-lg font-bold flex items-center justify-center transition-colors"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>

                  <div>
                    {/* Error display */}
                    {pError && (
                      <div className="mb-4 bg-red-950/40 border border-red-900/50 rounded-lg p-3 text-xs text-red-400 flex flex-col gap-1">
                        <span className="font-semibold uppercase tracking-wider text-[10px]">Error</span>
                        <span>{pError}</span>
                      </div>
                    )}

                    {/* Reserve Button */}
                    <button
                      onClick={() => handleReserve(product.id)}
                      disabled={isBtnDisabled}
                      className="w-full bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-slate-950 font-bold py-3 px-4 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 shadow-md shadow-cyan-500/10 active:scale-[0.98]"
                    >
                      {reserving[product.id] ? (
                        <span className="flex items-center justify-center gap-2">
                          <span className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></span>
                          Reserving...
                        </span>
                      ) : isOutOfStock ? (
                        'Cannot Reserve'
                      ) : (
                        'Reserve Stock'
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
