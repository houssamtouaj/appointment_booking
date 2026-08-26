package com.slotflow.support;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The suite, checking itself: no {@code Thread.sleep}, and no test reading the real clock.
 *
 * <h2>Why this is a test and not a note in a plan</h2>
 * Plan 14 calls both of these review blockers, and a review blocker enforced by review is enforced
 * until the afternoon somebody is in a hurry. Neither mistake fails anything when it is made — a
 * {@code Thread.sleep(200)} passes, and a {@code LocalDate.now()} passes every day except the one
 * where it is a Sunday, or the last of a month, or inside a DST transition. That is the definition
 * of the failure this file exists to prevent: the test that breaks a build somebody else started,
 * for a reason that is nowhere near the change they made.
 *
 * <p>{@link MutableClock} is the alternative to both, and it is strictly better than either: it
 * moves the whole application's idea of time at once, so a test can jump forward thirty-one minutes
 * and watch the sweeper act, in microseconds, deterministically.
 *
 * <h2>How the scan avoids the obvious false positive</h2>
 * Half a dozen files in this suite <em>discuss</em> {@code Thread.sleep} in their javadoc, this one
 * included, so a naive grep would fail on its own explanation. Comments are stripped before the
 * patterns are applied. The stripper is deliberately simple — it does not know that {@code //}
 * inside a string literal is not a comment — and that trade is the safe direction: truncating a line
 * at a URL can only hide a violation, never invent one, and a gate that cries wolf gets deleted.
 */
class TestHygieneTest {

    private static final Path TEST_SOURCES = Path.of("src", "test", "java");

    /**
     * Every way a test can read the wall clock, including the spellings that do not contain the word
     * {@code now}. {@code System.currentTimeMillis} belongs on this list precisely because banning
     * only {@code Instant.now()} would leave an obvious way round the rule.
     *
     * <p><b>{@code System.nanoTime} is deliberately absent.</b> It has no epoch: it cannot answer
     * "what is the date", so it cannot be the flake this rule is about — a test whose result depends
     * on the day it runs. What it does answer is "how long did that take", which is a different
     * measurement with a different failure mode, and {@code AvailabilityQueryCountIT} makes it
     * against a best-of-five and a generous bound. Banning it would force that guard to be deleted
     * or suppressed, and neither is an improvement on a rule that says what it means.
     */
    private static final List<Pattern> FORBIDDEN = List.of(
            Pattern.compile("Thread\\s*\\.\\s*sleep\\s*\\("),
            Pattern.compile("\\b(?:Instant|LocalDate|LocalDateTime|LocalTime|ZonedDateTime"
                    + "|OffsetDateTime|OffsetTime|Year|YearMonth|MonthDay)\\s*\\.\\s*now\\s*\\("),
            Pattern.compile("Clock\\s*\\.\\s*system(?:UTC|DefaultZone)\\s*\\("),
            Pattern.compile("System\\s*\\.\\s*currentTimeMillis\\s*\\("),
            Pattern.compile("new\\s+java\\.util\\.Date\\s*\\("));

    /**
     * The one file allowed to read real time, and the reason is not laziness.
     *
     * <p>Stripe's webhook library checks its five-minute tolerance against
     * {@code System.currentTimeMillis()} inside itself — correctly, because a replayed request is
     * old in real time whatever the application believes the date is. A signature stamped with
     * {@link TestTime#NOW} would be months outside that window and every webhook test would fail
     * with an error about timestamps rather than about signatures.
     *
     * <p>An allowlist rather than a suppression comment, so that adding to it is a visible edit to
     * this file with a sentence attached, instead of a line somebody drops in and nobody reads.
     */
    private static final Set<String> ALLOWED_TO_READ_REAL_TIME = Set.of("StripeSignatures.java");

    @Test
    @DisplayName("no test sleeps, and none reads the real clock")
    void theSuiteIsDeterministic() {
        List<String> violations = new ArrayList<>();

        for (Path source : javaSources()) {
            if (ALLOWED_TO_READ_REAL_TIME.contains(source.getFileName().toString())) {
                continue;
            }
            String code = withoutComments(read(source));
            for (Pattern forbidden : FORBIDDEN) {
                Matcher matcher = forbidden.matcher(code);
                while (matcher.find()) {
                    violations.add("%s:%d %s — use MutableClock or TestTime instead"
                            .formatted(TEST_SOURCES.relativize(source),
                                    lineOf(code, matcher.start()), matcher.group()));
                }
            }
        }

        assertThat(violations).isEmpty();
    }

    /**
     * The scan's own control, and not a formality. Everything above is a search that reports
     * success when it finds nothing, so a wrong working directory or a moved source root would turn
     * this class into a test that passes while reading zero files — the exact shape of security
     * test this repository refuses elsewhere. Surefire and Failsafe both fork with the module
     * directory as the working directory; if that ever changes, this fails first and says why.
     */
    @Test
    @DisplayName("the scan actually found the suite")
    void theScanIsLookingSomewhereReal() {
        assertThat(javaSources())
                .as("java sources under %s, resolved from %s", TEST_SOURCES,
                        Path.of("").toAbsolutePath())
                .hasSizeGreaterThan(50);
    }

    // ---------------------------------------------------------------------------------
    //  helpers
    // ---------------------------------------------------------------------------------

    private static List<Path> javaSources() {
        try (Stream<Path> tree = Files.walk(TEST_SOURCES)) {
            return tree.filter(path -> path.toString().endsWith(".java")).toList();
        } catch (IOException e) {
            throw new UncheckedIOException(
                    "could not walk " + TEST_SOURCES.toAbsolutePath(), e);
        }
    }

    private static String read(Path source) {
        try {
            return Files.readString(source, StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException("could not read " + source, e);
        }
    }

    /**
     * Comments removed, newlines kept.
     *
     * <p>The newlines are the reason this is not a one-line {@code replaceAll}: a violation is
     * reported as {@code file:line}, and collapsing a forty-line javadoc block would put every
     * later line number out by forty — a gate whose failure message sends you to the wrong place is
     * only slightly better than no gate. See the class note for what this stripper does not know.
     */
    private static String withoutComments(String source) {
        StringBuilder stripped = new StringBuilder(source.length());
        Matcher comment = Pattern.compile("(?s)/\\*.*?\\*/|//[^\\n]*").matcher(source);
        while (comment.find()) {
            comment.appendReplacement(stripped,
                    Matcher.quoteReplacement(comment.group().replaceAll("[^\\n]", "")));
        }
        return comment.appendTail(stripped).toString();
    }

    private static int lineOf(String code, int offset) {
        return (int) code.substring(0, offset).chars().filter(c -> c == '\n').count() + 1;
    }
}
