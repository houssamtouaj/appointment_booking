package com.slotflow.notification;

import java.nio.charset.StandardCharsets;
import java.util.Set;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.thymeleaf.templatemode.TemplateMode;
import org.thymeleaf.templateresolver.ClassLoaderTemplateResolver;
import org.thymeleaf.templateresolver.ITemplateResolver;

/**
 * Teaches Thymeleaf to resolve the plaintext half of every email.
 *
 * <p>Boot's auto-configured resolver appends {@code .html} and parses in HTML mode, which is right
 * for the other half and wrong twice over for a {@code .txt}: it would look for
 * {@code booking-confirmed.txt.html}, and if it found it, it would HTML-escape the ampersands in a
 * message nobody is going to render as HTML. This adds a second resolver in
 * {@link TemplateMode#TEXT}.
 *
 * <p>Boot collects every {@link ITemplateResolver} bean into the one {@code SpringTemplateEngine},
 * so declaring this is the whole wiring. The two cannot collide: {@code resolvablePatterns} confines
 * this one to text templates under {@code email/}, and the default resolver runs with
 * {@code check-template} on, so a name it cannot find falls through to the next resolver rather
 * than resolving to nothing.
 *
 * <p>Caching is left at Thymeleaf's default rather than tied to {@code spring.thymeleaf.cache}:
 * these templates are on the classpath, never edited at runtime, and re-parsing a text file on
 * every send is a cost with nothing to buy it.
 */
@Configuration
public class EmailTemplateConfig {

    @Bean
    ITemplateResolver plainTextEmailTemplateResolver() {
        ClassLoaderTemplateResolver resolver = new ClassLoaderTemplateResolver();
        resolver.setPrefix("templates/");
        resolver.setResolvablePatterns(Set.of("email/*.txt"));
        resolver.setTemplateMode(TemplateMode.TEXT);
        resolver.setCharacterEncoding(StandardCharsets.UTF_8.name());
        resolver.setCheckExistence(true);
        resolver.setOrder(0);
        return resolver;
    }
}
