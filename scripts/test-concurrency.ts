import { prisma } from '../src/lib/prisma';
import { ReservationService, ReservationError } from '../src/services/reservationService';
import { ReservationStatus } from '@prisma/client';

async function runTests() {
  console.log('--- STARTING CONCURRENCY AND INTEGRATION TESTS ---');

  // Verify connection
  try {
    await prisma.$connect();
    console.log('Database connected successfully.');
  } catch (error) {
    console.error('Failed to connect to database. Make sure DATABASE_URL is set correctly in .env and the database is running.');
    console.error(error);
    process.exit(1);
  }

  // 1. Reset Database & Create Test Data
  console.log('\n1. Seeding test data...');
  await prisma.idempotencyRecord.deleteMany({});
  await prisma.reservation.deleteMany({});
  await prisma.inventory.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.warehouse.deleteMany({});

  const product = await prisma.product.create({
    data: {
      name: 'Test Widget',
      description: 'Used for concurrency race-condition testing.',
    },
  });

  const warehouse = await prisma.warehouse.create({
    data: {
      name: 'Test Warehouse',
      location: 'Test Location',
    },
  });

  // Seed inventory with exactly 5 units of total stock
  const inventory = await prisma.inventory.create({
    data: {
      productId: product.id,
      warehouseId: warehouse.id,
      totalStock: 5,
      reservedStock: 0,
    },
  });

  console.log(`Seeded Inventory: totalStock = 5, reservedStock = 0 for Product: ${product.name} at Warehouse: ${warehouse.name}`);

  // 2. Run Concurrency Test
  console.log('\n2. Triggering 10 concurrent reservation requests for 1 unit each...');
  const promises = [];
  for (let i = 0; i < 10; i++) {
    // Generate a unique idempotency key for each request
    const uniqueKey = `idemp-key-concurrency-test-${i}`;
    promises.push(
      ReservationService.reserveStock(product.id, warehouse.id, 1, uniqueKey)
    );
  }

  const results = await Promise.allSettled(promises);

  let successCount = 0;
  let failureCount = 0;
  let conflictCount = 0;

  results.forEach((res, index) => {
    if (res.status === 'fulfilled') {
      successCount++;
      console.log(`[Request ${index + 1}] SUCCESS: Reserved ID ${res.value.id}`);
    } else {
      failureCount++;
      const err = res.reason;
      if (err instanceof ReservationError) {
        if (err.statusCode === 409) {
          conflictCount++;
        }
        console.log(`[Request ${index + 1}] FAILED: Status ${err.statusCode} - ${err.message}`);
      } else {
        console.log(`[Request ${index + 1}] FAILED: Unexpected error - ${err.message || err}`);
      }
    }
  });

  console.log('\nResults Summary:');
  console.log(`- Successful Reservations: ${successCount}`);
  console.log(`- Failed Reservations: ${failureCount}`);
  console.log(`- Out of Stock (409) Conflicts: ${conflictCount}`);

  // Verify stock levels in database
  const finalInventory = await prisma.inventory.findUnique({
    where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } },
  });

  const activeReservations = await prisma.reservation.count({
    where: { productId: product.id, warehouseId: warehouse.id, status: ReservationStatus.PENDING },
  });

  console.log(`\nDatabase Stock Check:`);
  console.log(`- totalStock: ${finalInventory?.totalStock}`);
  console.log(`- reservedStock: ${finalInventory?.reservedStock}`);
  console.log(`- availableStock (total - reserved): ${(finalInventory?.totalStock || 0) - (finalInventory?.reservedStock || 0)}`);
  console.log(`- Active Pending Reservations: ${activeReservations}`);

  // Assertions
  if (successCount === 5 && conflictCount === 5 && finalInventory?.reservedStock === 5) {
    console.log('\n✅ CONCURRENCY TEST PASSED: Exactly 5 reservations succeeded and stock remains consistent.');
  } else {
    console.error('\n❌ CONCURRENCY TEST FAILED: Stock level or success counts did not match expectations.');
  }

  // 3. Test Idempotency Concurrency
  console.log('\n3. Testing Idempotency safety under concurrent requests...');
  
  // Reset stock
  await prisma.reservation.deleteMany({});
  await prisma.inventory.update({
    where: { id: inventory.id },
    data: { reservedStock: 0 },
  });
  await prisma.idempotencyRecord.deleteMany({});

  console.log('Stock reset. Triggering 2 concurrent requests with the SAME Idempotency-Key...');
  const sharedKey = 'shared-idempotency-key-test';

  const idemPromises = [
    ReservationService.reserveStock(product.id, warehouse.id, 1, sharedKey),
    ReservationService.reserveStock(product.id, warehouse.id, 1, sharedKey),
  ];

  const idemResults = await Promise.allSettled(idemPromises);

  let idemSuccess = 0;
  let idemResultsData: any[] = [];

  idemResults.forEach((res, index) => {
    if (res.status === 'fulfilled') {
      idemSuccess++;
      idemResultsData.push(res.value);
      console.log(`[Idempotent Request ${index + 1}] SUCCESS: Reserved ID ${res.value.id}`);
    } else {
      console.log(`[Idempotent Request ${index + 1}] FAILED: ${res.reason.message}`);
    }
  });

  const finalInventoryIdem = await prisma.inventory.findUnique({
    where: { id: inventory.id },
  });

  console.log(`Final reservedStock after duplicate requests: ${finalInventoryIdem?.reservedStock}`);

  if (idemSuccess === 2 && idemResultsData[0]?.id === idemResultsData[1]?.id && finalInventoryIdem?.reservedStock === 1) {
    console.log('✅ IDEMPOTENCY CONCURRENCY TEST PASSED: Both requests succeeded and returned the identical reservation ID without double reserving stock.');
  } else {
    console.error('❌ IDEMPOTENCY CONCURRENCY TEST FAILED.');
  }

  await prisma.$disconnect();
}

runTests().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
