package com.slotflow.business;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Lookups by the public slug, which is how every unauthenticated request finds its tenant. */
public interface BusinessRepository extends JpaRepository<Business, UUID> {

    Optional<Business> findBySlug(String slug);

    /** Plan 05 answers a taken slug with 409 SLUG_TAKEN so the signup form can offer another. */
    boolean existsBySlug(String slug);
}
