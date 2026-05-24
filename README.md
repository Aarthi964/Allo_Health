# Concurrency-Safe Inventory Reservation System

A production-grade, transaction-safe inventory reservation system built with Next.js 15 App Router, TypeScript, Prisma ORM, and PostgreSQL.

This system guarantees inventory correctness under concurrent demand, preventing overselling by utilizing PostgreSQL row-level locks (`SELECT ... FOR UPDATE`) inside serialized atomic transactions.

---

## Core Features

- **Concurrency Safety**: Serialized stock allocation using PostgreSQL row-level locking ensures that if two users attempt to reserve the last unit of stock simultaneously, exactly one succeeds and the other receives an HTTP `409 Conflict`.
- **Database-Backed Idempotency**: Safe request retries using `Idempotency-Key` header mapping, preventing duplicate side effects.
- **Strict State Machine**: Formal reservation state transitions:
  - `PENDING` -> `CONFIRMED`
  - `PENDING` -> `RELEASED`
  - All invalid transitions (e.g. `CONFIRMED` -> `RELEASED`) are blocked and reject automatically.
- **Hybrid Expiry Cleanup**: Expired `PENDING` reservations are reclaimed via:
  - **Scoped Lazy Cleanup**: Reclaims expired items for the current product+warehouse atomically inside the reservation transaction itself.
  - **Batched Cron Cleanup**: A background cron job (`/api/cron/cleanup`) protected by a `CRON_SECRET` tokens checks and releases expired stock in small batches (up to 100 items per run, ordered by oldest first) to avoid database lock spikes.
- **Responsive Dashboard**: Beautiful dark dashboard UI indicating stock availability per warehouse, a checkout screen with a real-time countdown timer, loading states, and descriptive error views.

---

## Tech Stack

* **Framework**: Next.js 15 (App Router)
* **Language**: TypeScript
* **Database ORM**: Prisma ORM
* **Database**: PostgreSQL (Neon, Supabase, or Local PostgreSQL)
* **Styling**: Tailwind CSS
* **Validation**: Zod

---

## Environment Variables

Create a `.env` file in the root directory (based on `.env.example`):

```bash
# Database connection string (PostgreSQL)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/allo_project?schema=public"

# Secret token used to authorize the Vercel Cron cleanup job
CRON_SECRET="super-secret-cron-key-123"
```

---

## Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Generate Prisma Client & Run Migrations
Ensure PostgreSQL is running and `DATABASE_URL` is set, then execute:
```bash
# Generate the Prisma client
npx prisma generate

# Create and run the database migrations
npx prisma migrate dev --name init
```

### 3. Seed Database
Seed the database with sample products, warehouses, and realistic inventory counts (including a low stock warehouse for testing concurrency conflicts):
```bash
npx prisma db seed
```

### 4. Run Locally
Start the local Next.js development server:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the application.

---

## Concurrency Strategy: Why Row Locking Prevents Race Conditions

### The Problem with Naive Logic
In a naive `read-then-update` reservation implementation, the system:
1. Queries the database for available stock: `available = totalStock - reservedStock`.
2. If `available >= quantity`, updates the stock: `UPDATE "Inventory" SET "reservedStock" = "reservedStock" + quantity`.

Under high concurrency (e.g., two users booking the last available item simultaneously), both requests read the inventory at the exact same moment. Both see `available = 1`, both validate successfully, and both execute updates. As a result, the item is oversold (double-booked), leading to negative stock or unfulfilled orders.

### The Row-Level Locking Solution
To prevent this, our system uses PostgreSQL row-level locks via `SELECT ... FOR UPDATE` inside an atomic transaction.

```
    Transaction A (Reserve Unit)               Transaction B (Reserve Unit)
                 │                                          │
                 ▼                                          ▼
   Acquire SELECT ... FOR UPDATE              Acquire SELECT ... FOR UPDATE
          (Succeeds)                                (Blocks & Waits)
                 │                                          │
                 ▼                                          │
      Validate stock (available = 1)                        │
                 │                                          │
                 ▼                                          │
        reservedStock += 1                                  │
                 │                                          │
                 ▼                                          │
           Commit & Release Lock                            │
                 │                                          │
                 └─────────────────────────────────────────►│  Resumes (Lock Acquired)
                                                            │
                                                            ▼
                                               Validate stock (available = 0)
                                                            │
                                                            ▼
                                                  Aborts (HTTP 409)
```

1. **Locking**: When Transaction A requests stock, it executes:
   ```sql
   SELECT * FROM "Inventory" WHERE "productId" = $1 AND "warehouseId" = $2 FOR UPDATE;
   ```
   This places an exclusive write lock on that specific inventory row.
2. **Serialization**: If Transaction B makes a simultaneous request for the same product in the same warehouse, its query blocks and waits for Transaction A to finish.
3. **Validation After Lock**: Transaction B only resumes *after* Transaction A commits. When it does, Transaction B reads the newly updated `reservedStock` (which now includes Transaction A's booking), recalculates available stock, finds it is `0`, and fails gracefully, returning a `409 Conflict` (Not enough stock available).

---

## Transaction Safety Specifications

### 1. Reservation Transaction (`reserveStock`)
All actions run within a single transaction block:
1. Check if `Idempotency-Key` exists. If so, return cached response.
2. Release expired reservations *only* for the current `(productId, warehouseId)` (Scoped Lazy Cleanup) to reclaim stock.
3. Lock the `Inventory` row using `SELECT ... FOR UPDATE`.
4. Validate available stock. If insufficient, abort and rollback transaction (HTTP 409).
5. Increment `reservedStock` atomically.
6. Create `Reservation` with status `PENDING` and `expiresAt` (now + 10 minutes).
7. Save response details to `IdempotencyRecord`.
8. Commit.

### 2. Confirmation Transaction (`confirmReservation`)
1. Lock the `Reservation` row using `SELECT ... FOR UPDATE`.
2. Validate that status is `PENDING`. If `CONFIRMED` or `RELEASED`, reject immediately.
3. Validate expiration: If current time > `expiresAt`:
   - Decrement `reservedStock` on `Inventory` to reclaim stock.
   - Mark reservation status as `RELEASED`.
   - Commit and return `410 Gone` (Reservation expired).
4. Lock the `Inventory` row using `SELECT ... FOR UPDATE`.
5. Decrement `totalStock` and `reservedStock` in `Inventory`.
6. Update reservation status to `CONFIRMED`.
7. Commit.

### 3. Release Transaction (`releaseReservation`)
1. Lock the `Reservation` row using `SELECT ... FOR UPDATE`.
2. Validate that status is `PENDING`. If not, reject.
3. Lock the `Inventory` row using `SELECT ... FOR UPDATE`.
4. Decrement `reservedStock` in `Inventory` to return the stock.
5. Update reservation status to `RELEASED`.
6. Commit.

---

## Database Indexing Strategy

Prisma schema contains explicit indexes defined as follows:

```prisma
model Inventory {
  // ...
  @@unique([productId, warehouseId])
  @@index([productId, warehouseId])
}

model Reservation {
  // ...
  @@index([status])
  @@index([expiresAt])
  @@index([productId, warehouseId])
}
```

- `Inventory @@unique` and `@@index`: Accelerates `SELECT ... FOR UPDATE` row locks and stock checks.
- `Reservation @@index([status])` and `@@index([expiresAt])`: Optimizes background cron performance by allowing the database to perform high-speed index scans for oldest expired rows rather than performing costly full-table scans.
- `Reservation @@index([productId, warehouseId])`: Speeds up scoped lazy cleanups during incoming reservation requests.

---

## Testing Concurrency

We have built a dedicated integration and concurrency testing script to verify the row locking behavior under heavy load.

The script:
1. Seeds a test product with exactly `5` units of total stock and `0` reserved stock.
2. Fires `10` concurrent reservation requests for `1` unit each using `Promise.allSettled`.
3. Asserts that **exactly 5 requests succeed (status 201)** and **exactly 5 requests fail (status 409)**.
4. Asserts that the database stock states remain fully consistent (`reservedStock = 5` and `availableStock = 0`).
5. Fires concurrent requests with the *same* `Idempotency-Key` and asserts only one reservation is created, with both requests returning the identical result.

### Running the Concurrency Test
Once your database is configured and migrations are run, execute:
```bash
npx ts-node scripts/test-concurrency.ts
```

---

## Future Scaling Considerations

To scale this reservation system for ultra-high transaction volume (e.g. flash sales with millions of requests per second), the following patterns should be explored:

1. **Redis Distributed Locking (Redlock)**: Move lock acquisition out of PostgreSQL to Redis. This keeps Postgres transactions short and fast, preventing database connection starvation.
2. **Message Queue Cleanup Workers**: Offload reservation release actions to asynchronous background message queues (e.g. BullMQ, RabbitMQ) rather than processing them directly in HTTP handler threads or cron polling loops.
3. **Inventory Sharding**: Distribute inventory counts for high-demand items across multiple distinct database shards or rows (e.g., dividing stock of an item into 5 logical inventory rows) to reduce lock contention on a single row.
4. **Read Replicas**: Direct GET stock and product listing queries to read replicas, reserving the primary database node exclusively for write-intensive reservation and confirmation transactions.
5. **Reservation Event Streaming**: Stream reservation status changes (confirmed, expired, released) to event brokers like Apache Kafka or AWS Kinesis to trigger downstream shipping, email notifications, and analytics pipelines.
