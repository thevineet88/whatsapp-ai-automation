CREATE TABLE "batch_price_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"occupancy_type" text NOT NULL,
	"price_paise" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cancellation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"cutoff" text NOT NULL,
	"deduction" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_installments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"label" text NOT NULL,
	"amount_paise" integer NOT NULL,
	"due_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "batch_price_variants" ADD CONSTRAINT "batch_price_variants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_price_variants" ADD CONSTRAINT "batch_price_variants_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_rules" ADD CONSTRAINT "cancellation_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_rules" ADD CONSTRAINT "cancellation_rules_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_installments" ADD CONSTRAINT "payment_installments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_installments" ADD CONSTRAINT "payment_installments_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "batch_price_variants_tenant_id_idx" ON "batch_price_variants" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "batch_price_variants_batch_id_idx" ON "batch_price_variants" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "batch_price_variants_batch_occupancy_idx" ON "batch_price_variants" USING btree ("batch_id","occupancy_type");--> statement-breakpoint
CREATE INDEX "cancellation_rules_tenant_id_idx" ON "cancellation_rules" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "cancellation_rules_package_id_idx" ON "cancellation_rules" USING btree ("package_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cancellation_rules_package_sequence_idx" ON "cancellation_rules" USING btree ("package_id","sequence");--> statement-breakpoint
CREATE INDEX "payment_installments_tenant_id_idx" ON "payment_installments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payment_installments_package_id_idx" ON "payment_installments" USING btree ("package_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_installments_package_sequence_idx" ON "payment_installments" USING btree ("package_id","sequence");