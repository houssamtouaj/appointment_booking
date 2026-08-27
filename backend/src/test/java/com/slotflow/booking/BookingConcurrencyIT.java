package com.slotflow.booking;

import static org.assertj.core.api.Assertions.assertThat;

import com.slotflow.support.BookingScenario;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.test.web.servlet.MvcResult;

/**
 * The single most valuable test in this repository, and the claim the README makes.
 *
 * <p>Two threads, one slot, released together. Exactly one {@code 201} and exactly one {@code 409},
 * and exactly one row in the table afterwards. Against a real Postgres, through the real filter
 * chain and the real transaction manager, with nothing mocked — because everything this test is
 * about lives in the places a mock would replace.
 *
 * <h2>Why it has to be threads and not two sequential requests</h2>
 * A second request sent after the first has committed is refused by the availability check, which
 * is application code and proves nothing about concurrency. The interesting interleaving is the one
 * where <em>both</em> requests read the calendar before either writes to it: both see a free slot,
 * both pass every check in {@code PublicBookingService}, and both reach the insert. That is the
 * moment the whole design comes down to {@code booking_no_overlap}, and it is not reachable
 * sequentially.
 *
 * <h2>A latch, never a sleep</h2>
 * {@code Thread.sleep} would make the overlap probabilistic: too short and the threads miss each
 * other, too long and the build is slower for nothing, and either way the test is a coin flip
 * dressed as an assertion. Two latches make it deterministic — one for "both workers are alive and
 * inside the request path", one to release them in the same instant.
 *
 * <p>{@code MockMvc} is driven from both threads. That is the point rather than a shortcut: the
 * dispatcher, the filters and the transaction interceptor are what a real pair of requests goes
 * through, and a test that called the service directly would skip the layer where a second
 * connection and a second transaction come from.
 */
class BookingConcurrencyIT extends BookingScenario {

    /** Generous: the assertion is on the outcome, not on the latency, and CI machines are slow. */
    private static final int TIMEOUT_SECONDS = 30;

    @Test
    @DisplayName("two threads race for the same slot: exactly one 201, one 409, and one row")
    void exactlyOneOfTwoSimultaneousBookingsWins() throws Exception {
        // One staff member, so both requests are competing for the same calendar rather than being
        // spread across two by the any-staff tie-break.
        Salon salon = solo(aSalon());
        UUID dana = salon.dana().getId();

        List<MvcResult> results = raceFor(salon, NINE_AM, dana);

        List<Integer> statuses = results.stream()
                .map(result -> result.getResponse().getStatus())
                .sorted()
                .toList();
        assertThat(statuses)
                .as("the pair is the assertion: one winner, one conflict, no 500 and no second row")
                .containsExactly(HttpStatus.CREATED.value(), HttpStatus.CONFLICT.value());

        MvcResult conflict = results.stream()
                .filter(result -> result.getResponse().getStatus() == HttpStatus.CONFLICT.value())
                .findFirst()
                .orElseThrow();
        String body = conflict.getResponse().getContentAsString();
        assertThat(body)
                .as("the loser must be told which offer to retire, not merely that it lost")
                .contains("BOOKING_SLOT_TAKEN")
                .contains(NINE_AM.toString())
                .contains(dana.toString());

        assertThat(bookings.findActiveForStaffBetween(List.of(dana), NINE_AM, NINE_AM.plusSeconds(1)))
                .as("the database is the guarantee, so the row count is the real verdict")
                .hasSize(1);
    }

    /**
     * The same race for a slot whose <em>appointments</em> do not overlap and whose buffers do (D4).
     *
     * <p>Twenty minutes of setup and cleanup: 09:30–10:30 costs the calendar 09:10–10:50, and
     * 11:00–12:00 needs 10:40–12:00. The two appointments are half an hour apart — no customer would
     * ever see them as clashing — and the blocked ranges overlap by ten minutes. The constraint
     * refuses the pair anyway, because it is written over {@code blocked_from}/{@code blocked_to}.
     * Written over the raw appointment it would accept both and hand a stylist two customers with
     * no gap to clean up in.
     */
    @Test
    @DisplayName("D4: the race is decided over the buffers, not over the appointments")
    void twoBookingsWhoseBuffersOverlapCannotBothWin() throws Exception {
        Salon salon = solo(aSalonWithBuffers(20, 20));
        UUID dana = salon.dana().getId();

        // Both are on the grid and both are offered on an empty calendar; the second becomes
        // impossible only once the first exists.
        Instant halfPastNine = parisTime("2026-03-04T09:30");
        Instant eleven = parisTime("2026-03-04T11:00");

        List<Integer> statuses = new ArrayList<>();
        for (MvcResult result : race(
                bookRequestTask(salon, halfPastNine, dana, "first@example.test"),
                bookRequestTask(salon, eleven, dana, "second@example.test"))) {
            statuses.add(result.getResponse().getStatus());
        }

        assertThat(statuses).containsExactlyInAnyOrder(
                HttpStatus.CREATED.value(), HttpStatus.CONFLICT.value());
        assertThat(bookings.findActiveForStaffBetween(List.of(dana),
                parisTime("2026-03-04T08:00"), parisTime("2026-03-04T18:00")))
                .hasSize(1);
    }

    // ---------------------------------------------------------------------------------
    //  the harness
    // ---------------------------------------------------------------------------------

    private List<MvcResult> raceFor(Salon salon, Instant startsAt, UUID staffId) throws Exception {
        return race(bookRequestTask(salon, startsAt, staffId, "first@example.test"),
                bookRequestTask(salon, startsAt, staffId, "second@example.test"));
    }

    /**
     * Two request builders in, two results out, both threads released at the same instant.
     *
     * <p>The email addresses differ so that the per-email rate limit (D12) cannot be what decides
     * the race. It is disabled for the whole suite anyway; relying on that would make this test
     * depend on a property set three classes away.
     */
    private List<MvcResult> race(Callable<MvcResult> first, Callable<MvcResult> second)
            throws Exception {
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch go = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            List<Future<MvcResult>> futures = List.of(
                    pool.submit(gatedBy(ready, go, first)),
                    pool.submit(gatedBy(ready, go, second)));

            assertThat(ready.await(TIMEOUT_SECONDS, TimeUnit.SECONDS))
                    .as("both workers must be at the line before either is released")
                    .isTrue();
            go.countDown();

            List<MvcResult> results = new ArrayList<>(2);
            for (Future<MvcResult> future : futures) {
                results.add(future.get(TIMEOUT_SECONDS, TimeUnit.SECONDS));
            }
            return results;
        } finally {
            pool.shutdownNow();
        }
    }

    private static Callable<MvcResult> gatedBy(CountDownLatch ready, CountDownLatch go,
            Callable<MvcResult> task) {
        return () -> {
            ready.countDown();
            if (!go.await(TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
                throw new IllegalStateException("never released");
            }
            return task.call();
        };
    }

    private Callable<MvcResult> bookRequestTask(Salon salon, Instant startsAt, UUID staffId,
            String email) {
        return () -> mockMvc.perform(bookRequest(salon, startsAt, staffId, email)).andReturn();
    }
}
