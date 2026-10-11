DROP INDEX "fulfillment_commands_order_line_uidx";--> statement-breakpoint
CREATE UNIQUE INDEX "fulfillment_commands_order_line_type_uidx" ON "fulfillment_commands" USING btree ("order_line_id","command_type");
