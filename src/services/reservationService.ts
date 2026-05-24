import { prisma } from '@/lib/prisma';
import { ReservationStatus } from '@prisma/client';

export class ReservationError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'ReservationError';
  }
}

export interface ReservationResult {
  id: string;
  productId: string;
  warehouseId: string;
  quantity: number;
  status: string;
  expiresAt: Date;
}

export class ReservationService {
  /**
   * Temporary reserve stock for a product in a warehouse.
   * Runs inside a transaction and locks the Inventory row.
   */
  static async reserveStock(
    productId: string,
    warehouseId: string,
    quantity: number,
    idempotencyKey?: string
  ): Promise<ReservationResult> {
    // 1. Idempotency Check
    if (idempotencyKey) {
      const existingRecord = await prisma.idempotencyRecord.findUnique({
        where: { key: idempotencyKey },
      });

      if (existingRecord) {
        if (existingRecord.statusCode === 201) {
          return JSON.parse(existingRecord.responseBody) as ReservationResult;
        } else {
          throw new ReservationError(existingRecord.statusCode, existingRecord.responseBody);
        }
      }
    }

    try {
      return await prisma.$transaction(async (tx) => {
        // Step 1: Scoped Lazy Cleanup
        // Release any expired PENDING reservations for this product and warehouse combo
        const now = new Date();
        const expiredReservations = await tx.reservation.findMany({
          where: {
            productId,
            warehouseId,
            status: ReservationStatus.PENDING,
            expiresAt: { lt: now },
          },
        });

        for (const expired of expiredReservations) {
          // Reclaim stock atomically in Inventory
          await tx.$executeRaw`
            UPDATE "Inventory"
            SET "reservedStock" = "reservedStock" - ${expired.quantity}, "updatedAt" = NOW()
            WHERE "productId" = ${productId} AND "warehouseId" = ${warehouseId}
          `;

          // Mark reservation as RELEASED
          await tx.reservation.update({
            where: { id: expired.id },
            data: { status: ReservationStatus.RELEASED },
          });
        }

        // Step 2: Lock the Inventory row using SELECT ... FOR UPDATE
        const inventories = await tx.$queryRaw<any[]>`
          SELECT * FROM "Inventory"
          WHERE "productId" = ${productId} AND "warehouseId" = ${warehouseId}
          LIMIT 1
          FOR UPDATE
        `;

        if (inventories.length === 0) {
          throw new ReservationError(404, 'Product inventory not found in the specified warehouse.');
        }

        const inventory = inventories[0];

        // Step 3: Recalculate available stock after lazy cleanup and locking
        const availableStock = inventory.totalStock - inventory.reservedStock;

        // Step 4: Validate stock
        if (availableStock < quantity) {
          throw new ReservationError(409, 'Not enough stock available');
        }

        // Step 5: Increment reservedStock
        await tx.$executeRaw`
          UPDATE "Inventory"
          SET "reservedStock" = "reservedStock" + ${quantity}, "updatedAt" = NOW()
          WHERE "id" = ${inventory.id}
        `;

        // Step 6: Create Reservation (expires in 10 minutes)
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
        const reservation = await tx.reservation.create({
          data: {
            productId,
            warehouseId,
            quantity,
            status: ReservationStatus.PENDING,
            expiresAt,
          },
        });

        const result: ReservationResult = {
          id: reservation.id,
          productId: reservation.productId,
          warehouseId: reservation.warehouseId,
          quantity: reservation.quantity,
          status: reservation.status,
          expiresAt: reservation.expiresAt,
        };

        // Step 7: Store success response in IdempotencyRecord
        if (idempotencyKey) {
          await tx.idempotencyRecord.create({
            data: {
              key: idempotencyKey,
              statusCode: 201,
              responseBody: JSON.stringify(result),
            },
          });
        }

        return result;
      });
    } catch (error) {
      // If the error is a ReservationError, write it to idempotency record for caching if needed
      // (or let it bubble so client can retry. Usually we cache success, but let's cache 409 conflict too)
      if (error instanceof ReservationError && idempotencyKey) {
        try {
          await prisma.idempotencyRecord.create({
            data: {
              key: idempotencyKey,
              statusCode: error.statusCode,
              responseBody: error.message,
            },
          });
        } catch {
          // Ignore key conflicts if another process wrote it
        }
      }
      throw error;
    }
  }

  /**
   * Confirm reservation and convert it into a final purchase.
   * Decrements both totalStock and reservedStock, marking reservation CONFIRMED.
   */
  static async confirmReservation(id: string): Promise<ReservationResult> {
    return await prisma.$transaction(async (tx) => {
      // Step 1: Lock the Reservation row using SELECT ... FOR UPDATE
      const reservations = await tx.$queryRaw<any[]>`
        SELECT * FROM "Reservation"
        WHERE "id" = ${id}
        LIMIT 1
        FOR UPDATE
      `;

      if (reservations.length === 0) {
        throw new ReservationError(404, 'Reservation not found.');
      }

      const reservation = reservations[0];

      // Step 2: Validate state transitions (Must be PENDING)
      if (reservation.status === ReservationStatus.CONFIRMED) {
        throw new ReservationError(400, 'Reservation is already confirmed.');
      }
      if (reservation.status === ReservationStatus.RELEASED) {
        throw new ReservationError(400, 'Reservation is already released.');
      }
      if (reservation.status !== ReservationStatus.PENDING) {
        throw new ReservationError(400, `Invalid status transition from ${reservation.status}.`);
      }

      // Step 3: Validate expiration
      const now = new Date();
      const isExpired = new Date(reservation.expiresAt) < now;

      if (isExpired) {
        // Expired confirmation logic: Reclaim stock, mark RELEASED, return 410 Gone
        await tx.$executeRaw`
          UPDATE "Inventory"
          SET "reservedStock" = "reservedStock" - ${reservation.quantity}, "updatedAt" = NOW()
          WHERE "productId" = ${reservation.productId} AND "warehouseId" = ${reservation.warehouseId}
        `;

        await tx.reservation.update({
          where: { id },
          data: { status: ReservationStatus.RELEASED },
        });

        throw new ReservationError(410, 'Reservation expired');
      }

      // Step 4: Atomic Stock Transfer (Decrement totalStock & reservedStock)
      // Lock Inventory first to ensure correctness
      await tx.$executeRaw`
        SELECT 1 FROM "Inventory"
        WHERE "productId" = ${reservation.productId} AND "warehouseId" = ${reservation.warehouseId}
        FOR UPDATE
      `;

      await tx.$executeRaw`
        UPDATE "Inventory"
        SET 
          "totalStock" = "totalStock" - ${reservation.quantity},
          "reservedStock" = "reservedStock" - ${reservation.quantity},
          "updatedAt" = NOW()
        WHERE "productId" = ${reservation.productId} AND "warehouseId" = ${reservation.warehouseId}
      `;

      // Step 5: Update status to CONFIRMED
      const updatedReservation = await tx.reservation.update({
        where: { id },
        data: { status: ReservationStatus.CONFIRMED },
      });

      return {
        id: updatedReservation.id,
        productId: updatedReservation.productId,
        warehouseId: updatedReservation.warehouseId,
        quantity: updatedReservation.quantity,
        status: updatedReservation.status,
        expiresAt: updatedReservation.expiresAt,
      };
    });
  }

  /**
   * Release reservation manually (cancel reservation).
   * Decrements reservedStock and marks reservation RELEASED.
   */
  static async releaseReservation(id: string): Promise<ReservationResult> {
    return await prisma.$transaction(async (tx) => {
      // Step 1: Lock the Reservation row using SELECT ... FOR UPDATE
      const reservations = await tx.$queryRaw<any[]>`
        SELECT * FROM "Reservation"
        WHERE "id" = ${id}
        LIMIT 1
        FOR UPDATE
      `;

      if (reservations.length === 0) {
        throw new ReservationError(404, 'Reservation not found.');
      }

      const reservation = reservations[0];

      // Step 2: Validate state transitions (Must be PENDING)
      if (reservation.status === ReservationStatus.CONFIRMED) {
        throw new ReservationError(400, 'Cannot release a confirmed reservation.');
      }
      if (reservation.status === ReservationStatus.RELEASED) {
        throw new ReservationError(400, 'Reservation is already released.');
      }
      if (reservation.status !== ReservationStatus.PENDING) {
        throw new ReservationError(400, `Invalid status transition from ${reservation.status}.`);
      }

      // Step 3: Lock Inventory row
      await tx.$executeRaw`
        SELECT 1 FROM "Inventory"
        WHERE "productId" = ${reservation.productId} AND "warehouseId" = ${reservation.warehouseId}
        FOR UPDATE
      `;

      // Step 4: Decrement reservedStock
      await tx.$executeRaw`
        UPDATE "Inventory"
        SET "reservedStock" = "reservedStock" - ${reservation.quantity}, "updatedAt" = NOW()
        WHERE "productId" = ${reservation.productId} AND "warehouseId" = ${reservation.warehouseId}
      `;

      // Step 5: Update status to RELEASED
      const updatedReservation = await tx.reservation.update({
        where: { id },
        data: { status: ReservationStatus.RELEASED },
      });

      return {
        id: updatedReservation.id,
        productId: updatedReservation.productId,
        warehouseId: updatedReservation.warehouseId,
        quantity: updatedReservation.quantity,
        status: updatedReservation.status,
        expiresAt: updatedReservation.expiresAt,
      };
    });
  }

  /**
   * Batched cleanup of expired reservations.
   * Fetches oldest 100 expired reservations and transactionally releases them.
   */
  static async cleanupExpiredReservations(batchLimit = 100): Promise<{ processed: number; errors: number }> {
    const now = new Date();
    
    // Fetch oldest expired PENDING reservations
    const expiredReservations = await prisma.reservation.findMany({
      where: {
        status: ReservationStatus.PENDING,
        expiresAt: { lt: now },
      },
      orderBy: { expiresAt: 'asc' },
      take: batchLimit,
    });

    let processed = 0;
    let errors = 0;

    for (const reservation of expiredReservations) {
      try {
        await prisma.$transaction(async (tx) => {
          // Lock Reservation Row
          const res = await tx.$queryRaw<any[]>`
            SELECT * FROM "Reservation"
            WHERE "id" = ${reservation.id}
            LIMIT 1
            FOR UPDATE
          `;

          if (res.length === 0 || res[0].status !== ReservationStatus.PENDING) {
            return; // Already processed by concurrent request
          }

          // Lock Inventory Row
          await tx.$executeRaw`
            SELECT 1 FROM "Inventory"
            WHERE "productId" = ${reservation.productId} AND "warehouseId" = ${reservation.warehouseId}
            FOR UPDATE
          `;

          // Decrement stock
          await tx.$executeRaw`
            UPDATE "Inventory"
            SET "reservedStock" = "reservedStock" - ${reservation.quantity}, "updatedAt" = NOW()
            WHERE "productId" = ${reservation.productId} AND "warehouseId" = ${reservation.warehouseId}
          `;

          // Update status to RELEASED
          await tx.reservation.update({
            where: { id: reservation.id },
            data: { status: ReservationStatus.RELEASED },
          });
        });

        processed++;
      } catch (err) {
        console.error(`Failed to clean up reservation ${reservation.id}:`, err);
        errors++;
      }
    }

    return { processed, errors };
  }
}
