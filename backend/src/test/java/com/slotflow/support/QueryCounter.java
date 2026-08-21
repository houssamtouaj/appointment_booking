package com.slotflow.support;

import jakarta.persistence.EntityManagerFactory;
import org.hibernate.SessionFactory;
import org.hibernate.stat.Statistics;

/**
 * How many SQL statements a piece of work actually issued.
 *
 * <p>The one assertion that catches an N+1 before it is deployed. A test that only checks the
 * response body passes just as happily against a loop that asks the same three questions once per
 * day of the range, and the difference between those two implementations is the difference between a
 * 200 ms month view and a five-second one — visible in a demo, invisible in a green build.
 *
 * <p>Prepared statements and not Hibernate's query count: the two differ once a load is served from
 * the persistence context, and it is the round trips to Postgres that cost the time this exists to
 * protect. Requires {@code hibernate.generate_statistics}, which {@link IntegrationTest} switches on
 * for the whole suite so that enabling it cannot fork the shared application context.
 *
 * <p>Deltas rather than {@code Statistics.clear()}: clearing throws away everything else the session
 * factory has recorded, and a counter whose correctness depends on nobody else in the suite having
 * an opinion is a counter that will one day be wrong for a reason nobody can find.
 */
public final class QueryCounter {

    /** {@code mockMvc.perform} throws, so the measured block has to be allowed to. */
    @FunctionalInterface
    public interface Work {
        void run() throws Exception;
    }

    private final Statistics statistics;

    public QueryCounter(EntityManagerFactory entityManagerFactory) {
        this.statistics = entityManagerFactory.unwrap(SessionFactory.class).getStatistics();
        if (!statistics.isStatisticsEnabled()) {
            throw new IllegalStateException(
                    "hibernate.generate_statistics is off, so every count here would be zero");
        }
    }

    /** The number of statements {@code work} issued. */
    public long statementsDuring(Work work) throws Exception {
        long before = statistics.getPrepareStatementCount();
        work.run();
        return statistics.getPrepareStatementCount() - before;
    }
}
