import { Redis } from "ioredis";

export function createRedis(url: string) {
  return new Redis(url);
}
export type RedisClient = ReturnType<typeof createRedis>;

// BullMQ requires maxRetriesPerRequest disabled on its blocking connection.
export function createBullMQConnection(url: string) {
  return new Redis(url, { maxRetriesPerRequest: null });
}
