import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

// We fallback to a mock/placeholder connection string during Next.js build collection
// to avoid compile-time crashes if DATABASE_URL is not set in the build environment.
const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/placeholder?schema=public';

const pool = new Pool({
  connectionString: databaseUrl,
  max: 10, // Limit connections per pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

const adapter = new PrismaPg(pool);

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
export { pool };
