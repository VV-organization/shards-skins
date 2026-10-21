CREATE TABLE guest_payment_contexts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL UNIQUE,
 token_digest text NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE steam_refill_claims (
 payment_id uuid PRIMARY KEY, user_id text NOT NULL, email text NOT NULL,
 claimed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX steam_refill_claims_user_idx ON steam_refill_claims(user_id);
CREATE INDEX steam_refill_contact_email_idx ON steam_refill_payments ((metadata->>'contactEmail'));
--> statement-breakpoint
CREATE FUNCTION claim_new_guest_steam_payment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.metadata->>'guestCheckout' = 'true' THEN
  PERFORM pg_advisory_xact_lock(hashtext('email:' || (NEW.metadata->>'contactEmail')));
  INSERT INTO steam_refill_claims(payment_id,user_id,email)
   SELECT NEW.id,e.user_id,e.email FROM email_identities e JOIN users u ON u.id=e.user_id
   WHERE e.email=NEW.metadata->>'contactEmail' AND u.steam_id64 IS NOT NULL AND NOT u.disabled
   ON CONFLICT(payment_id) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guest_steam_payment_claim AFTER INSERT ON steam_refill_payments
 FOR EACH ROW EXECUTE FUNCTION claim_new_guest_steam_payment();
--> statement-breakpoint
CREATE FUNCTION claim_verified_guest_steam_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('email:' || NEW.email));
 INSERT INTO steam_refill_claims(payment_id,user_id,email)
 SELECT p.id,NEW.user_id,NEW.email FROM steam_refill_payments p
 WHERE p.metadata->>'guestCheckout'='true' AND p.metadata->>'contactEmail'=NEW.email
 AND EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND steam_id64 IS NOT NULL AND NOT disabled)
 ON CONFLICT(payment_id) DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER verified_email_steam_history AFTER INSERT OR UPDATE ON email_identities
 FOR EACH ROW EXECUTE FUNCTION claim_verified_guest_steam_history();
