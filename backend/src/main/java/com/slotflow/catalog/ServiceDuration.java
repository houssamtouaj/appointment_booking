package com.slotflow.catalog;

import jakarta.validation.Constraint;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.Payload;
import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * A service duration: 5 to 480 minutes, and a multiple of five.
 *
 * <p>One annotation rather than {@code @Min} plus {@code @Max} plus a service-level check, for the
 * reason {@link com.slotflow.security.Password} gives: the three ways a duration can be wrong are
 * one rule about one field, and they have to arrive as a 422 naming {@code durationMinutes} in the
 * body the React forms already parse. A check in the service would be the same mistake reported in
 * a different shape.
 *
 * <p><b>Five minutes is a grid of its own, and deliberately not the business's
 * {@code slotGranularityMinutes}.</b> That is the tempting wrong validation plan 07 names: a
 * granularity governs where a slot may <em>start</em>, so a 45-minute service on a 15-minute grid
 * is ordinary, and a 60-minute service on a 20-minute grid is too. Validating one against the other
 * would make changing the granularity able to invalidate a catalog that was never wrong.
 *
 * <p>{@code null} is valid, as with every constraint in this codebase: absence belongs to
 * {@code @NotNull} on create and means "leave it alone" on a patch.
 */
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.METHOD, ElementType.FIELD, ElementType.ANNOTATION_TYPE,
        ElementType.CONSTRUCTOR, ElementType.PARAMETER, ElementType.TYPE_USE})
@Constraint(validatedBy = ServiceDuration.Validator.class)
public @interface ServiceDuration {

    /** The minimum a business can sell. Below it, an appointment is a rounding error. */
    int MIN_MINUTES = 5;

    /** Eight hours. Anything longer is a project, not an appointment. */
    int MAX_MINUTES = 480;

    /** Never used: the validator replaces it with whichever of the three below applies. */
    String message() default "is not an acceptable duration";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

    class Validator implements ConstraintValidator<ServiceDuration, Integer> {

        @Override
        public boolean isValid(Integer minutes, ConstraintValidatorContext context) {
            if (minutes == null) {
                return true;
            }
            String message = messageFor(minutes);
            if (message == null) {
                return true;
            }
            // Three separate messages rather than one covering all of them: "must be between 5 and
            // 480 minutes and a multiple of 5" tells somebody who typed 47 nothing about which half
            // they got wrong.
            context.disableDefaultConstraintViolation();
            context.buildConstraintViolationWithTemplate(message).addConstraintViolation();
            return false;
        }

        private static String messageFor(int minutes) {
            if (minutes < MIN_MINUTES) {
                return "must be at least " + MIN_MINUTES + " minutes";
            }
            if (minutes > MAX_MINUTES) {
                return "must be at most " + MAX_MINUTES + " minutes";
            }
            return minutes % MIN_MINUTES == 0
                    ? null
                    : "must be a multiple of " + MIN_MINUTES + " minutes";
        }
    }
}
