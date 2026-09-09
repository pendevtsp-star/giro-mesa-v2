ALTER TYPE "public"."growth_delivery_status" ADD VALUE IF NOT EXISTS 'delivery_failed';
ALTER TYPE "public"."growth_delivery_status" ADD VALUE IF NOT EXISTS 'returned';
