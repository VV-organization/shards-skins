ALTER TABLE "payment_provider_attempts"
  ADD CONSTRAINT "payment_provider_attempts_one_parent_check"
  CHECK (
    (
      CASE WHEN "top_up_payment_id" IS NULL THEN 0 ELSE 1 END
      + CASE WHEN "steam_refill_payment_id" IS NULL THEN 0 ELSE 1 END
    ) = 1
  );
