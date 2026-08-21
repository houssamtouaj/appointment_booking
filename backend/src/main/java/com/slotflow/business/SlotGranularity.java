package com.slotflow.business;

import jakarta.validation.Constraint;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.Payload;
import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import java.util.List;
import java.util.Set;

/**
 * The step between offered start times: 5, 10, 15, 20, 30 or 60 minutes, and nothing else.
 *
 * <p>An allowed set rather than a range, because the numbers in between are legal arithmetic and a
 * baffling product. A granularity of 7 gives a customer 09:00, 09:07, 09:14, 09:21 — slots no
 * business would advertise and no customer would trust, produced by a typo nobody would think to
 * look for. The database allows 1–480 ({@code booking_policy_granularity_chk}) because a check
 * constraint is a floor and not a product decision; this is where the product decision lives, and it
 * is here rather than in the service so the rejection names {@code slotGranularityMinutes} in the
 * same body every other field uses.
 *
 * <p>Every value in the set divides 60, which is not a coincidence and is worth keeping: a grid that
 * does not divide the hour drifts against the wall clock, so the slots offered on a Tuesday afternoon
 * would not line up with the ones offered that morning.
 */
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.METHOD, ElementType.FIELD, ElementType.ANNOTATION_TYPE,
        ElementType.CONSTRUCTOR, ElementType.PARAMETER, ElementType.TYPE_USE})
@Constraint(validatedBy = SlotGranularity.Validator.class)
public @interface SlotGranularity {

    /** Published so the settings form can render the same six options the API accepts. */
    List<Integer> ALLOWED = List.of(5, 10, 15, 20, 30, 60);

    String message() default "must be one of 5, 10, 15, 20, 30 or 60 minutes";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

    class Validator implements ConstraintValidator<SlotGranularity, Integer> {

        private static final Set<Integer> ALLOWED_SET = Set.copyOf(ALLOWED);

        @Override
        public boolean isValid(Integer minutes, ConstraintValidatorContext context) {
            // Null is valid here, as with every constraint in this codebase: absence is @NotNull's
            // job, and one violation per mistake is what lets a form show one message per input.
            return minutes == null || ALLOWED_SET.contains(minutes);
        }
    }
}
