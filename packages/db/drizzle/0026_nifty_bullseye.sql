CREATE INDEX "pos_tabs_reports_closed_idx" ON "pos_tabs" USING btree ("organization_id", "unit_id", "status", "closed_at");
