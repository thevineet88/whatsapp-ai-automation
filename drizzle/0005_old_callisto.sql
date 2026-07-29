CREATE TYPE "public"."escalation_severity" AS ENUM('hard', 'soft');--> statement-breakpoint
ALTER TYPE "public"."conversation_status" ADD VALUE 'awaiting_human' BEFORE 'closed';--> statement-breakpoint
ALTER TYPE "public"."conversation_status" ADD VALUE 'human_active' BEFORE 'closed';--> statement-breakpoint
CREATE TABLE "package_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "escalations" ADD COLUMN "severity" "escalation_severity" DEFAULT 'hard' NOT NULL;--> statement-breakpoint
ALTER TABLE "package_aliases" ADD CONSTRAINT "package_aliases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_aliases" ADD CONSTRAINT "package_aliases_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "package_aliases_tenant_id_idx" ON "package_aliases" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "package_aliases_package_id_idx" ON "package_aliases" USING btree ("package_id");--> statement-breakpoint
CREATE UNIQUE INDEX "package_aliases_package_alias_idx" ON "package_aliases" USING btree ("package_id","alias");