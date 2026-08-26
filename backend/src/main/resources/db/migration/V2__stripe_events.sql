-- =====================================================================================
--  V2__stripe_events.sql — webhook idempotency (plan 11).
--
--  Stripe retries. It retries a webhook that timed out, a webhook that answered 500, and a
--  webhook it is simply not sure about — for up to three days. So "this endpoint will receive
--  every event exactly once" is not a property of anything, and an endpoint that confirms a
--  booking on each delivery is an endpoint that will one day charge the customer's slot to
--  two different states in the same minute.
--
--  This table is the record of what has already been applied. It is deliberately the whole
--  mechanism rather than half of one: the state change itself is also idempotent (only
--  PENDING -> CONFIRMED, only PENDING -> CANCELLED), so a replay that somehow got past this
--  row would still change nothing. Two independent reasons the same event cannot be applied
--  twice, because the cost of being wrong here is a customer's money.
-- =====================================================================================

CREATE TABLE stripe_event (
    -- Stripe's own event id (evt_...), not a uuid of ours. That is the point: the id has to be
    -- the one the sender uses, or two deliveries of the same event would be two rows here.
    -- The primary key is the idempotency guarantee — a second INSERT is a duplicate-key error,
    -- which is a guarantee from Postgres rather than from a check the application remembered
    -- to run.
    id          varchar(255) PRIMARY KEY,
    -- What kind of event it was, for the log and for anybody reading this table to work out
    -- why a booking changed. Never used to decide anything: the payload decides.
    type        varchar(120) NOT NULL,
    -- Which booking it moved, when the payload named one. Nullable because an event we choose
    -- not to act on is still recorded as processed — that is what stops Stripe retrying it.
    booking_id  uuid,
    received_at timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE stripe_event IS
    'One row per Stripe event id already applied. The PK is the replay guard.';

-- No foreign key to booking. An event can arrive for a booking that has since been deleted in
-- a demo reset, and a webhook that 500s because of a dangling reference is a webhook Stripe
-- will retry forever — turning a tidy-up into an outage. The column is for humans.
CREATE INDEX stripe_event_booking_idx ON stripe_event (booking_id);

-- Nothing prunes this table yet. It gains one row per payment event and no more, which for a
-- booking system is a rounding error next to refresh_token; when that stops being true, the
-- sweep is a DELETE of rows older than Stripe's retry window and nothing else.
