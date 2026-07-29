CREATE TABLE "message_traces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"intent" text NOT NULL,
	"anchor_package_id" uuid,
	"tool_calls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"retrieved_chunk_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"prompt_version" text NOT NULL,
	"config_version" integer NOT NULL,
	"llm_model" text,
	"llm_input_tokens" integer,
	"llm_output_tokens" integer,
	"retrieval_top_score" integer,
	"latency_ms" integer NOT NULL,
	"result" text NOT NULL,
	"escalation_reason" text,
	"source_chunk_ids" jsonb,
	"langfuse_trace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message_traces" ADD CONSTRAINT "message_traces_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_traces" ADD CONSTRAINT "message_traces_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_traces" ADD CONSTRAINT "message_traces_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_traces" ADD CONSTRAINT "message_traces_anchor_package_id_packages_id_fk" FOREIGN KEY ("anchor_package_id") REFERENCES "public"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_traces_tenant_id_idx" ON "message_traces" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "message_traces_conversation_id_idx" ON "message_traces" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "message_traces_message_id_idx" ON "message_traces" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "message_traces_result_idx" ON "message_traces" USING btree ("result");--> statement-breakpoint
CREATE INDEX "message_traces_created_at_idx" ON "message_traces" USING btree ("created_at");