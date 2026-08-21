package com.slotflow.security;

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
 * The password length rule, as a constraint the three requests that accept a password can declare.
 *
 * <p>It replaces {@code @Size}, which cannot express it: {@code @Size} counts characters and
 * BCrypt counts bytes ({@link Passwords}). A custom constraint rather than a check in each service
 * so that the failure arrives as a 422 naming {@code password}, in the same body the React forms
 * already parse for every other field — a service-level throw would be a different shape for the
 * same kind of mistake.
 *
 * <p>{@code null} is valid here. Emptiness belongs to {@code @NotBlank}, which every one of the
 * three declares alongside this: two annotations, two messages, so an absent password does not
 * arrive under the heading "must be at least 8 characters".
 */
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.METHOD, ElementType.FIELD, ElementType.ANNOTATION_TYPE,
        ElementType.CONSTRUCTOR, ElementType.PARAMETER, ElementType.TYPE_USE})
@Constraint(validatedBy = Password.Validator.class)
public @interface Password {

    /**
     * Never used. The validator replaces the default violation with one of the two messages in
     * {@link Passwords}, because "too short" and "too long in bytes" are different things to tell
     * somebody and one message covering both would tell them neither.
     */
    String message() default "is not an acceptable password";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

    class Validator implements ConstraintValidator<Password, String> {

        @Override
        public boolean isValid(String password, ConstraintValidatorContext context) {
            if (password == null) {
                return true;
            }
            String message = messageFor(password);
            if (message == null) {
                return true;
            }
            context.disableDefaultConstraintViolation();
            context.buildConstraintViolationWithTemplate(message).addConstraintViolation();
            return false;
        }

        private static String messageFor(String password) {
            if (Passwords.isTooShort(password)) {
                return Passwords.TOO_SHORT_MESSAGE;
            }
            return Passwords.exceedsBcryptLimit(password) ? Passwords.TOO_LONG_MESSAGE : null;
        }
    }
}
