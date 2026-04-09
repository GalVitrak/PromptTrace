import { Prisma } from "@prisma/client";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function prismaErrorMessage(err: unknown): string | null {
  const msg = messageOf(err);

  if (msg.includes("does not exist") && /database/i.test(msg)) {
    return 'PostgreSQL database is missing. From the server folder run `npm run db:create`, then `npm run db:push` (or `npx prisma migrate deploy`).';
  }

  if (err instanceof Prisma.PrismaClientInitializationError) {
    if (/credential|authentication|password/i.test(msg))
      return "Database authentication failed. Check DATABASE_URL username/password; special characters in passwords must be URL-encoded in the connection string.";
    return "Database connection failed. Check DATABASE_URL and ensure PostgreSQL is running.";
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P1001")
      return "Cannot reach database server. Confirm host, port, and that PostgreSQL is running.";
    if (err.code === "P1000")
      return "Database authentication failed. Verify DATABASE_URL credentials.";
    if (err.code === "P1003")
      return 'Database does not exist. Run `npm run db:create` in server/, then apply the schema with `npm run db:push`.';
  }

  return null;
}
