CREATE TYPE "public"."conversation_phase" AS ENUM('collecting_custom_package', 'collecting_booking');--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "phase" "conversation_phase";--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "collector_data" jsonb;--> statement-breakpoint
ALTER TABLE "escalations" ADD COLUMN "detail" text;