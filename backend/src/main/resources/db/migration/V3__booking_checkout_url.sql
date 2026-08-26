-- =====================================================================================
--  V3__booking_checkout_url.sql — where an unpaid booking goes to become a paid one.
--
--  V1 stored stripe_session_id, which is enough to *resolve* a webhook back to its booking and
--  not enough to send anybody anywhere. The hosted page's URL is a separate value that Stripe
--  returns once, when the session is created, and cannot be reconstructed from the id.
--
--  Three readers need it, and only one of them is the response to the request that created it:
--
--    * the 201 body, so the booking page can redirect straight to Checkout
--    * the "we are holding your slot" email (D10), which is what a customer who closed the tab
--      actually has in their hand
--    * GET /api/public/bookings/{token}, so the manage page can offer "pay now" instead of
--      showing a PENDING booking with no way to finish it
--
--  Without the column the second and third are impossible, and a customer whose browser
--  crashed during checkout has a slot held for thirty minutes and no way to claim it.
-- =====================================================================================

ALTER TABLE booking ADD COLUMN stripe_checkout_url varchar(500);

COMMENT ON COLUMN booking.stripe_checkout_url IS
    'Stripe hosted Checkout page for the outstanding deposit. Set with stripe_session_id and '
    'dead once the session expires; the booking is CANCELLED by then either way.';

-- 500 rather than 255: a Checkout URL is around 120 characters today and is entirely Stripe's
-- to lengthen. Truncating a payment link is a failure that looks like a broken page rather
-- than like a database error, so the column is sized for a format nobody here controls.
