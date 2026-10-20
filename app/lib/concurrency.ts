/**
 * Like Promise.all(items.map(fn)), but at most `limit` calls run at once.
 *
 * Print runs go up to 50 orders, and each order may open a DB transaction
 * (chargePrint) or hit the weather API. Firing all of them together
 * exhausted Prisma's small connection pool on the production container:
 * "Unable to start a transaction in the given time" (2026-10-20, 50-order
 * print). Keep per-order fan-outs behind this.
 */
export async function mapLimit<T>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** Per-order work in a print run: few enough to stay inside the DB pool. */
export const PRINT_CONCURRENCY = 4;
