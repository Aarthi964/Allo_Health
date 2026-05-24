import { prisma } from '../src/lib/prisma';
import { ReservationStatus } from '@prisma/client';

async function main() {
  console.log('Starting database seeding...');

  // Reset database state before seeding
  console.log('Cleaning up existing data...');
  await prisma.idempotencyRecord.deleteMany({});
  await prisma.reservation.deleteMany({});
  await prisma.inventory.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.warehouse.deleteMany({});

  // 1. Create Warehouses
  const warehouseAlpha = await prisma.warehouse.create({
    data: {
      name: 'Warehouse Alpha',
      location: 'New York, NY',
    },
  });

  const warehouseBeta = await prisma.warehouse.create({
    data: {
      name: 'Warehouse Beta',
      location: 'London, UK',
    },
  });

  const warehouseGamma = await prisma.warehouse.create({
    data: {
      name: 'Warehouse Gamma',
      location: 'Tokyo, JP',
    },
  });

  console.log('Warehouses seeded successfully.');

  // 2. Create Products
  const productsData = [
    {
      name: 'Precision Laser Pointer',
      description: 'Ultra-bright green beam precision calibration laser pointer.',
    },
    {
      name: 'Mechanical Ergonomic Keyboard',
      description: 'Split layout mechanical keyboard with hot-swappable tactile switches.',
    },
    {
      name: 'UltraWide Curved Monitor 34"',
      description: 'Curved IPS display with 144Hz refresh rate and USB-C power delivery.',
    },
    {
      name: 'Noise Cancelling Headphones',
      description: 'Active noise cancelling wireless headphones with 40-hour battery life.',
    },
    {
      name: 'Portable SSD 2TB',
      description: 'High-speed external solid state drive with USB 3.2 Gen 2 support.',
    },
  ];

  for (const item of productsData) {
    const product = await prisma.product.create({
      data: item,
    });

    console.log(`Product seeded: ${product.name}`);

    // 3. Create Inventory levels for each product in each warehouse
    // Warehouse Alpha has high stock (10 to 50)
    await prisma.inventory.create({
      data: {
        productId: product.id,
        warehouseId: warehouseAlpha.id,
        totalStock: Math.floor(Math.random() * 40) + 10,
        reservedStock: 0,
      },
    });

    // Warehouse Beta has medium stock (5 to 25)
    await prisma.inventory.create({
      data: {
        productId: product.id,
        warehouseId: warehouseBeta.id,
        totalStock: Math.floor(Math.random() * 20) + 5,
        reservedStock: 0,
      },
    });

    // Warehouse Gamma has very low stock (1 to 5) - ideal for concurrency and out-of-stock tests
    await prisma.inventory.create({
      data: {
        productId: product.id,
        warehouseId: warehouseGamma.id,
        totalStock: Math.floor(Math.random() * 5) + 1,
        reservedStock: 0,
      },
    });
  }

  console.log('Database seeding finished successfully!');
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
