DROP INDEX "accounts_provider_account_idx";--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "issuer" text;--> statement-breakpoint
CREATE INDEX "accounts_provider_account_idx" ON "accounts" USING btree ("provider_id","account_id");