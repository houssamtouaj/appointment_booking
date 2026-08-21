package com.slotflow.business;

import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Lookups by the public slug, which is how every unauthenticated request finds its tenant. */
public interface BusinessRepository extends JpaRepository<Business, UUID> {

    /**
     * <b>The lookup every public endpoint uses</b>, and the one place the slug in a URL is
     * normalised.
     *
     * <p>Slugs are stored lower-cased — {@code Business.normaliseSlug} folds the case before it
     * checks the schema's own {@code ^[a-z0-9-]{3,40}$} — while {@code RegisterRequest} accepts
     * {@code ^[A-Za-z0-9-]{3,40}$} and promises in as many words that "Dana-Clinic" is a usable
     * answer rather than a validation error. Those two facts only agree if the read folds the case
     * too. Without this, {@code /api/public/businesses/Dana-Clinic/staff} is a 404 for a business
     * that plainly exists: the slug is on the business's own printed card, and a customer who
     * capitalises it is told the shop does not exist.
     *
     * <p>It is a {@code default} method rather than a note in each caller because D9's staff list
     * is the first of several public endpoints — services, availability, booking — that all resolve
     * their tenant from a path segment, and every one of them would otherwise copy the exact match.
     * The trim is for the same reason as {@code register}'s: a slug pasted with a stray space is a
     * typo, not a different business.
     */
    default Optional<Business> findByPublicSlug(String slug) {
        return slug == null
                ? Optional.empty()
                : findBySlug(slug.trim().toLowerCase(Locale.ROOT));
    }

    /** Exact match on the stored value. Public callers want {@link #findByPublicSlug}. */
    Optional<Business> findBySlug(String slug);

    /** Plan 05 answers a taken slug with 409 SLUG_TAKEN so the signup form can offer another. */
    boolean existsBySlug(String slug);
}
