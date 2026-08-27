package com.slotflow.demo;

/**
 * The three facts about the demo tenant that more than one class needs to agree on.
 *
 * <p>{@link DemoDataSeeder} writes them, {@link DemoLoginController} reads them, and
 * {@code DemoSeedIT} asserts on them. A constant rather than configuration on purpose: a demo
 * account whose address can be changed by an environment variable is one that the README can
 * document wrongly, and the whole value of this profile is that the credentials printed above the
 * fold of the README are the ones that work.
 *
 * <p>{@link #OWNER_PASSWORD} is a published credential to a database that is rebuilt from this file,
 * which is what makes committing it a documentation decision rather than a leak. Nothing else in
 * this repository holds one, and nothing else should: {@code JWT_SECRET}, the Stripe keys and the
 * SMTP credentials are environment-only, and {@code .env.example} carries placeholders.
 */
public final class DemoBusiness {

    /** The public URL segment: {@code /api/public/businesses/demo-salon}. */
    public static final String SLUG = "demo-salon";

    public static final String OWNER_EMAIL = "demo@slotflow.app";

    /**
     * Eight characters, which is exactly {@link com.slotflow.security.Passwords#MIN_LENGTH} — so
     * this value also proves the seeded account could have been created through
     * {@code POST /api/auth/register} rather than around it.
     */
    public static final String OWNER_PASSWORD = "demo1234";

    private DemoBusiness() {}
}
