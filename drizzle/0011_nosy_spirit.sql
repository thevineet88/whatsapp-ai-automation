ALTER TABLE "conversations" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "status" SET DEFAULT 'open'::text;--> statement-breakpoint
DROP TYPE "public"."conversation_status";--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('open', 'escalated', 'awaiting_human', 'human_active');--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "status" SET DEFAULT 'open'::"public"."conversation_status";--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "status" SET DATA TYPE "public"."conversation_status" USING "status"::"public"."conversation_status";