package com.slotflow.support;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Every environment variable this application reads is documented in {@code .env.example}.
 *
 * <h2>Why a test rather than a habit</h2>
 * It is the last line of the backend's definition of done, and it is the one that decays fastest:
 * adding {@code ${SOME_NEW_FLAG:false}} to a YAML file takes five seconds, works immediately on the
 * machine it was added on, and is discovered by whoever deploys next — as a feature that is
 * mysteriously off, with nothing anywhere naming the variable that would turn it on. Nobody notices
 * an undocumented default until it is the wrong one.
 *
 * <p>Documented means <em>mentioned as a key</em>, commented out or not. Plenty of these should
 * stay commented: {@code PORT} is injected by the platform and {@code BCRYPT_STRENGTH} should
 * almost never be set by hand. The requirement is that a reader who needs to change one can find
 * out that it exists and what it does, which is what {@code .env.example} is for.
 *
 * <h2>What it deliberately does not check</h2>
 * The other direction — a key in {@code .env.example} that nothing reads — is left alone. That file
 * also carries Compose's own variables and a few notes, and a test that insisted on an exact
 * correspondence would be a test somebody has to argue with every time they add a comment.
 */
class EnvironmentDocumentationTest {

    /**
     * Resolved from the module directory, which Surefire and Failsafe both fork with as the working
     * directory. {@code .env.example} and {@code docker-compose.yml} belong to the repository rather
     * than to this module — they configure the whole stack — so the path leaves it.
     */
    private static final Path REPOSITORY_ROOT = Path.of("..");

    private static final List<Path> READS_THE_ENVIRONMENT = List.of(
            Path.of("src", "main", "resources", "application.yml"),
            Path.of("src", "main", "resources", "application-local.yml"),
            REPOSITORY_ROOT.resolve("docker-compose.yml"));

    private static final Path ENV_EXAMPLE = REPOSITORY_ROOT.resolve(".env.example");

    /**
     * {@code ${NAME}}, {@code ${NAME:default}} and Compose's {@code ${NAME:-default}} all start the
     * same way, and a nested default such as {@code ${SERVER_PORT:${PORT:8080}}} contributes both
     * names because every occurrence is matched independently. Upper case only, which is what
     * separates an environment variable from a Spring property placeholder like
     * {@code ${app.cors.allowed-origins}}.
     */
    private static final Pattern PLACEHOLDER = Pattern.compile("\\$\\{([A-Z][A-Z0-9_]*)");

    /** A key in {@code .env.example}, whether or not the line is commented out. */
    private static final Pattern DOCUMENTED_KEY = Pattern.compile("(?m)^\\s*#?\\s*([A-Z][A-Z0-9_]*)\\s*=");

    @Test
    @DisplayName("no variable the app reads is missing from .env.example")
    void everyVariableIsDocumented() {
        Set<String> read = new LinkedHashSet<>();
        READS_THE_ENVIRONMENT.forEach(file -> collectInto(read, PLACEHOLDER, file));

        Set<String> documented = new LinkedHashSet<>();
        collectInto(documented, DOCUMENTED_KEY, ENV_EXAMPLE);

        assertThat(read)
                .as("add these to .env.example, with a sentence saying what they do")
                .isSubsetOf(documented);
    }

    /**
     * The control, for the same reason {@link TestHygieneTest} has one: everything above is a search
     * that succeeds by finding nothing, so a moved file or a changed working directory would turn
     * this into a test that reads no YAML and passes.
     */
    @Test
    @DisplayName("the scan actually read the configuration")
    void theScanIsLookingSomewhereReal() {
        Set<String> read = new LinkedHashSet<>();
        READS_THE_ENVIRONMENT.forEach(file -> collectInto(read, PLACEHOLDER, file));

        assertThat(read)
                .as("environment placeholders found, resolved from %s", Path.of("").toAbsolutePath())
                .contains("JWT_SECRET", "DB_URL", "CORS_ALLOWED_ORIGINS")
                .hasSizeGreaterThan(20);
    }

    private static void collectInto(Set<String> names, Pattern pattern, Path file) {
        String content;
        try {
            content = Files.readString(file, StandardCharsets.UTF_8);
        } catch (IOException e) {
            // Not a skip. A file this test cannot read is a file whose variables are unchecked, and
            // silently passing is the failure mode the control test above exists to prevent.
            throw new UncheckedIOException("could not read " + file.toAbsolutePath(), e);
        }
        Matcher matcher = pattern.matcher(content);
        while (matcher.find()) {
            names.add(matcher.group(1));
        }
    }
}
