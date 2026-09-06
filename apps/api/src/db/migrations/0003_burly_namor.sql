ALTER TABLE "recipes" DROP CONSTRAINT "recipes_head_version_id_versions_id_fk";
--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_head_version_id_versions_id_fk" FOREIGN KEY ("head_version_id") REFERENCES "public"."versions"("id") ON DELETE set null ON UPDATE no action;