package com.slotflow.demo;

import com.slotflow.availability.AvailabilityOverride;
import com.slotflow.availability.AvailabilityOverrideRepository;
import com.slotflow.availability.WorkingHours;
import com.slotflow.availability.WorkingHoursRepository;
import com.slotflow.booking.Booking;
import com.slotflow.booking.BookingRepository;
import com.slotflow.booking.GuestContact;
import com.slotflow.business.BookingPolicy;
import com.slotflow.business.BookingPolicyRepository;
import com.slotflow.business.Business;
import com.slotflow.business.BusinessRepository;
import com.slotflow.catalog.ServiceOffering;
import com.slotflow.catalog.ServiceOfferingRepository;
import com.slotflow.catalog.StaffService;
import com.slotflow.catalog.StaffServiceRepository;
import com.slotflow.staff.Role;
import com.slotflow.staff.User;
import com.slotflow.staff.UserRepository;
import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Currency;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * A salon that looks like it has been trading for a month, created on startup under the
 * {@code demo} profile.
 *
 * <p>What this exists for is one click: a stranger opens the deployed URL, presses "log in as demo
 * admin", and lands on a dashboard with money on it, a calendar with appointments in it, and a
 * no-show rate. An empty dashboard is the most common way a portfolio demo falls flat, and no
 * amount of correct code compensates for it.
 *
 * <h2>An {@code ApplicationRunner}, not a Flyway migration</h2>
 * Demo data is not schema. It has to be environment-scoped ({@code @Profile}), re-runnable, and —
 * the decisive one — <b>generated relative to the clock</b>: hard-coded 2026 dates in a migration
 * look abandoned within a month, and a demo whose calendar is empty because the seed is in the past
 * is worse than no demo. Every date below is an offset from today, so redeploying in three months
 * still shows a busy fortnight.
 *
 * <h2>Idempotent by existence check</h2>
 * A restart must not produce a second salon. The check is {@code existsBySlug}, and the slug's
 * unique index is what makes it a guarantee rather than a hope: two instances booting at the same
 * instant both see nothing and both insert, and one of them loses on the constraint. That is the
 * correct outcome for a single-instance demo, and the reason this seeder does not try to hold a
 * lock it would then have to explain.
 *
 * <p>A failure here <b>fails startup</b>, deliberately. The only reason to run this profile is the
 * demo data; a context that comes up without it serves a login button that does not work, and a
 * green deployment is then the worst possible signal. The seeder is idempotent, so the restart the
 * platform performs is a retry rather than a duplicate.
 *
 * <h2>Nothing here goes through a service</h2>
 * Rows are built through the entities' own factories and written with repositories. Driving the
 * public API instead would mean forty HTTP round trips, forty confirmation emails to invented
 * addresses, and — for the {@code COMPLETED} and {@code NO_SHOW} history the dashboard needs — a
 * clock this class does not own moved backwards three weeks. The entities are where the invariants
 * live ({@code Booking} derives its own blocked range, so D4 holds by construction), which is what
 * makes going around the services safe rather than a shortcut.
 */
@Component
@Profile("demo")
public class DemoDataSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DemoDataSeeder.class);

    /**
     * Not UTC, on purpose. The whole timezone design (D11 — wall-clock working hours interpreted in
     * the business zone) is invisible in a demo that runs at offset zero, and {@code Europe/Paris}
     * puts a DST transition inside the seeded window twice a year.
     */
    private static final ZoneId ZONE = ZoneId.of("Europe/Paris");

    private static final String NAME = "Belle Époque — Salon de coiffure";
    private static final int DEPOSIT_PERCENT = 20;

    /** Three weeks of history and a fortnight of forward bookings, inclusive of both ends. */
    private static final int HISTORY_DAYS = 21;
    private static final int FUTURE_DAYS = 14;

    /**
     * One candidate appointment in three becomes a booking. A full calendar reads as fake and
     * leaves no bookable slot for a reviewer to click; a sparse one has nothing to look at. Over
     * the window below this lands around forty rows, which is what the dashboard needs to show
     * six non-zero figures.
     */
    private static final int ONE_IN = 3;

    private final Clock clock;
    private final PasswordEncoder passwordEncoder;
    private final BusinessRepository businesses;
    private final BookingPolicyRepository policies;
    private final UserRepository users;
    private final ServiceOfferingRepository services;
    private final StaffServiceRepository assignments;
    private final WorkingHoursRepository workingHours;
    private final AvailabilityOverrideRepository overrides;
    private final BookingRepository bookings;
    private final TransactionTemplate writes;

    public DemoDataSeeder(Clock clock, PasswordEncoder passwordEncoder,
            BusinessRepository businesses, BookingPolicyRepository policies,
            UserRepository users, ServiceOfferingRepository services,
            StaffServiceRepository assignments, WorkingHoursRepository workingHours,
            AvailabilityOverrideRepository overrides, BookingRepository bookings,
            PlatformTransactionManager transactionManager) {
        this.clock = clock;
        this.passwordEncoder = passwordEncoder;
        this.businesses = businesses;
        this.policies = policies;
        this.users = users;
        this.services = services;
        this.assignments = assignments;
        this.workingHours = workingHours;
        this.overrides = overrides;
        this.bookings = bookings;
        this.writes = new TransactionTemplate(transactionManager);
    }

    @Override
    public void run(ApplicationArguments args) {
        if (businesses.existsBySlug(DemoBusiness.SLUG)) {
            log.info("Demo business \"{}\" already exists; seeding nothing.", DemoBusiness.SLUG);
            return;
        }

        // Outside the transaction, for the reason AuthService.writes sets out at length: BCrypt at
        // strength 12 is a quarter of a second of deliberate key stretching per hash, and it needs
        // no database at all. Three hashes is not a scalability problem here — the point is that
        // this file does not model the wrong thing for the next person who copies it.
        String passwordHash = passwordEncoder.encode(DemoBusiness.OWNER_PASSWORD);

        int seeded = writes.execute(status -> seed(passwordHash));
        log.info("Seeded demo business \"{}\" with {} bookings.", DemoBusiness.SLUG, seeded);
    }

    private int seed(String passwordHash) {
        Business business = businesses.save(
                new Business(DemoBusiness.SLUG, NAME, ZONE, Currency.getInstance("EUR")));
        business.setDepositPolicy(true, DEPOSIT_PERCENT);
        policies.save(BookingPolicy.defaultsFor(business.getId()));

        List<Staff> staff = createStaff(business, passwordHash);
        List<ServiceOffering> offerings = createServices(business);
        assign(business, staff, offerings);
        Closures closures = createOverrides(business, staff);

        return createBookings(business, staff, offerings, closures);
    }

    // ---------------------------------------------------------------------------------
    //  people
    // ---------------------------------------------------------------------------------

    /**
     * A seeded staff member: the row, the weekly template, and the two times of day their
     * appointments start.
     *
     * @param slots the two candidate start times. Two rather than a grid, spaced so that the
     *              longest service plus its buffers — 90 minutes and 15 either side, a two-hour
     *              block — cannot reach the next one. That is what keeps the seeder from ever
     *              tripping {@code booking_no_overlap} on its own data, structurally, rather than
     *              by hoping the arithmetic worked out
     */
    private record Staff(User user, List<Shift> shifts, List<LocalTime> slots,
            List<Integer> serviceIndexes) {
    }

    /** One range of the weekly template. Two rows on the same day is a split shift. */
    private record Shift(DayOfWeek day, LocalTime from, LocalTime to) {
    }

    private List<Staff> createStaff(Business business, String passwordHash) {
        // Staggered starts, one split shift and one Saturday, because a template where everybody
        // works the same hours makes the merged calendar and the per-staff availability query look
        // like the same feature.
        Staff owner = new Staff(
                users.save(User.owner(business.getId(), DemoBusiness.OWNER_EMAIL,
                        "Camille Bérard", passwordHash)),
                List.of(
                        new Shift(DayOfWeek.TUESDAY, LocalTime.of(9, 0), LocalTime.of(17, 0)),
                        // The split shift: a real lunch break, which is the case that makes
                        // (staff_id, day_of_week) deliberately non-unique.
                        new Shift(DayOfWeek.WEDNESDAY, LocalTime.of(9, 0), LocalTime.of(12, 30)),
                        new Shift(DayOfWeek.WEDNESDAY, LocalTime.of(13, 30), LocalTime.of(18, 0)),
                        new Shift(DayOfWeek.THURSDAY, LocalTime.of(9, 0), LocalTime.of(17, 0)),
                        new Shift(DayOfWeek.FRIDAY, LocalTime.of(9, 0), LocalTime.of(17, 0))),
                List.of(LocalTime.of(10, 0), LocalTime.of(14, 30)),
                List.of(0, 1, 2, 3, 4, 5));

        Staff colourist = new Staff(
                users.save(staffMember(business, "amelie@slotflow.app", "Amélie Rousseau",
                        passwordHash)),
                List.of(
                        new Shift(DayOfWeek.MONDAY, LocalTime.of(10, 0), LocalTime.of(18, 30)),
                        new Shift(DayOfWeek.TUESDAY, LocalTime.of(10, 0), LocalTime.of(18, 30)),
                        new Shift(DayOfWeek.WEDNESDAY, LocalTime.of(10, 0), LocalTime.of(18, 30)),
                        new Shift(DayOfWeek.THURSDAY, LocalTime.of(10, 0), LocalTime.of(18, 30)),
                        new Shift(DayOfWeek.FRIDAY, LocalTime.of(10, 0), LocalTime.of(18, 30)),
                        // The only Saturday in the business. Its afternoon slot does not fit
                        // inside these hours, and the containment check below drops it without
                        // needing a special case.
                        new Shift(DayOfWeek.SATURDAY, LocalTime.of(9, 0), LocalTime.of(14, 0))),
                List.of(LocalTime.of(10, 30), LocalTime.of(15, 0)),
                List.of(2, 3, 4, 5));

        Staff barber = new Staff(
                users.save(staffMember(business, "marc@slotflow.app", "Marc Lefèvre",
                        passwordHash)),
                List.of(
                        new Shift(DayOfWeek.MONDAY, LocalTime.of(8, 30), LocalTime.of(16, 0)),
                        new Shift(DayOfWeek.TUESDAY, LocalTime.of(8, 30), LocalTime.of(16, 0)),
                        new Shift(DayOfWeek.THURSDAY, LocalTime.of(8, 30), LocalTime.of(16, 0)),
                        new Shift(DayOfWeek.FRIDAY, LocalTime.of(8, 30), LocalTime.of(16, 0))),
                List.of(LocalTime.of(9, 0), LocalTime.of(13, 0)),
                List.of(0, 1, 2));

        List<Staff> staff = List.of(owner, colourist, barber);
        staff.forEach(this::createWorkingHours);
        return staff;
    }

    /**
     * Active with a password, rather than {@link User#invited}. A demo whose staff cannot log in
     * cannot show the one thing that distinguishes an owner's dashboard from a staff member's — the
     * same endpoint scoped to one calendar.
     */
    private User staffMember(Business business, String email, String fullName,
            String passwordHash) {
        User user = User.invited(business.getId(), email, fullName, Role.STAFF);
        user.acceptInvitation(fullName, passwordHash);
        return user;
    }

    private void createWorkingHours(Staff staff) {
        staff.shifts().forEach(shift -> workingHours.save(
                new WorkingHours(staff.user().getId(), shift.day(), shift.from(), shift.to())));
    }

    // ---------------------------------------------------------------------------------
    //  catalogue
    // ---------------------------------------------------------------------------------

    private record ServiceSpec(String name, String description, int minutes, long priceCents,
            int bufferBefore, int bufferAfter) {
    }

    /**
     * Six services with genuinely different durations — 20, 30, 45, 60 and 90 minutes — because a
     * catalogue of identical half-hours makes the slot grid look like a fixed timetable rather than
     * something computed from a duration.
     *
     * <p>Four of them carry non-zero buffers, and that is the point of the column: buffers are
     * invisible in a screenshot unless something uses them, so the colour work costs the calendar
     * a quarter of an hour more than it charges for, and the exclusion constraint is enforcing that
     * wider range (D4).
     */
    private List<ServiceOffering> createServices(Business business) {
        List<ServiceSpec> specs = List.of(
                new ServiceSpec("Frange", "A fringe trim between appointments.",
                        20, 1_500L, 0, 0),
                new ServiceSpec("Coupe classique", "Wash, cut and finish.",
                        30, 3_500L, 0, 5),
                new ServiceSpec("Coupe & brushing", "Cut with a full blow-dry.",
                        45, 4_800L, 5, 5),
                new ServiceSpec("Couleur", "Single-process colour, roots to ends.",
                        60, 7_200L, 10, 10),
                new ServiceSpec("Balayage complet", "Hand-painted highlights and a gloss.",
                        90, 12_000L, 15, 15),
                new ServiceSpec("Soin du cuir chevelu", "Scalp treatment and massage.",
                        30, 2_800L, 0, 0));

        List<ServiceOffering> offerings = new ArrayList<>(specs.size());
        for (ServiceSpec spec : specs) {
            ServiceOffering offering = new ServiceOffering(
                    business.getId(), spec.name(), spec.minutes(), spec.priceCents());
            offering.describe(spec.description());
            offering.setBuffers(spec.bufferBefore(), spec.bufferAfter());
            offerings.add(services.save(offering));
        }
        return offerings;
    }

    /**
     * Who performs what. Overlapping but not identical: the barber does not do colour and the
     * colourist does not do fringes, so {@code GET /api/public/businesses/{slug}/staff?serviceId=}
     * (D9) returns a different list per service instead of always the whole team.
     */
    private void assign(Business business, List<Staff> staff, List<ServiceOffering> offerings) {
        for (Staff member : staff) {
            for (int index : member.serviceIndexes()) {
                assignments.save(new StaffService(business.getId(), member.user().getId(),
                        offerings.get(index).getId()));
            }
        }
    }

    // ---------------------------------------------------------------------------------
    //  overrides
    // ---------------------------------------------------------------------------------

    /**
     * The dates the seeder must not book into.
     *
     * @param businessWide closed for everybody (D5)
     * @param perStaff     {@code staffId + date}, for a single staff member's day off
     */
    private record Closures(Set<LocalDate> businessWide, Set<String> perStaff) {

        boolean isClosed(UUID staffId, LocalDate date) {
            return businessWide.contains(date) || perStaff.contains(key(staffId, date));
        }

        static String key(UUID staffId, LocalDate date) {
            return staffId + "@" + date;
        }
    }

    /**
     * One business-wide closure, one staff holiday week, one extra evening — the three shapes the
     * override table can take, so the exceptions screen has something of each kind in it and the
     * engine's precedence rule ({@code BLOCKED} beats {@code EXTRA}) has data behind it.
     */
    private Closures createOverrides(Business business, List<Staff> staff) {
        LocalDate today = today();
        Set<LocalDate> businessWide = new HashSet<>();
        Set<String> perStaff = new HashSet<>();

        // D5: one row, everybody, and it stays correct as staff join and leave.
        LocalDate holiday = today.plusDays(3);
        overrides.save(AvailabilityOverride.businessWideClosure(
                business.getId(), holiday, "Jour férié — salon fermé"));
        businessWide.add(holiday);

        // A week off for one staff member: seven whole-day rows, which is what the API writes and
        // therefore what the calendar has to render. Inside the forward booking window on purpose —
        // an absence scheduled past the end of it would be a row nothing renders and nothing tests.
        User onHoliday = staff.get(2).user();
        for (int day = 0; day < 7; day++) {
            LocalDate date = today.plusDays(8 + day);
            overrides.save(AvailabilityOverride.blockedDay(
                    business.getId(), onHoliday.getId(), date, "Congés"));
            perStaff.add(Closures.key(onHoliday.getId(), date));
        }

        // Extra hours outside the weekly template, which is the only direction a staff-level
        // override can add rather than remove. No closure to record: it opens time, it does not
        // take any away.
        overrides.save(AvailabilityOverride.extraHours(
                business.getId(), staff.get(1).user().getId(), today.plusDays(5),
                LocalTime.of(18, 30), LocalTime.of(21, 0), "Ouverture en soirée"));

        return new Closures(businessWide, perStaff);
    }

    // ---------------------------------------------------------------------------------
    //  bookings
    // ---------------------------------------------------------------------------------

    private record Guest(String name, String email, String phone) {
    }

    /**
     * Invented customers, at {@code example.com} — reserved by RFC 2606 and therefore incapable of
     * reaching a real inbox. That matters more than it looks: this data is deployed, and a seeder
     * that puts plausible-looking third-party addresses on forty rows is one scheduled job away
     * from mailing strangers.
     */
    private static final List<Guest> GUESTS = List.of(
            new Guest("Léa Fontaine", "lea.fontaine@example.com", "+33 6 12 34 56 78"),
            new Guest("Thomas Girard", "thomas.girard@example.com", "+33 6 23 45 67 89"),
            new Guest("Inès Moreau", "ines.moreau@example.com", null),
            new Guest("Julien Barbier", "julien.barbier@example.com", "+33 6 45 67 89 01"),
            new Guest("Chloé Mercier", "chloe.mercier@example.com", "+33 6 56 78 90 12"),
            new Guest("Hugo Villeneuve", "hugo.villeneuve@example.com", null),
            new Guest("Sarah Benali", "sarah.benali@example.com", "+33 6 78 90 12 34"),
            new Guest("Antoine Roux", "antoine.roux@example.com", "+33 6 89 01 23 45"),
            new Guest("Manon Deschamps", "manon.deschamps@example.com", null),
            new Guest("Yasmine Haddad", "yasmine.haddad@example.com", "+33 7 01 23 45 67"),
            new Guest("Pierre Lacroix", "pierre.lacroix@example.com", "+33 7 12 34 56 78"),
            new Guest("Nadia Sirvent", "nadia.sirvent@example.com", null));

    private static final List<String> NOTES = List.of(
            "Sensitive scalp — please patch test.",
            "Parking behind the salon, gate code 4821.",
            "Running from the office, may be five minutes late.");

    /** One appointment the seeder has decided to write, before it knows what status it ends in. */
    private record Candidate(Staff staff, ServiceOffering service, Instant startsAt) {
    }

    private int createBookings(Business business, List<Staff> staff,
            List<ServiceOffering> offerings, Closures closures) {
        List<Candidate> candidates = candidates(staff, offerings, closures);
        Instant now = clock.instant();

        // Statuses are assigned from the collected list rather than decided as each row is built,
        // because "exactly two no-shows" is a fact about the whole set. Deciding per row would make
        // the count depend on how many candidates happened to fit the working hours, and a demo
        // with a no-show rate of zero — or of nine percent — says something different about the
        // business to anyone reading the dashboard.
        long finished = candidates.stream().filter(candidate -> hasFinished(candidate, now)).count();
        long firstNoShow = finished / 4;
        long secondNoShow = finished * 3 / 4;

        int written = 0;
        int finishedIndex = 0;
        for (Candidate candidate : candidates) {
            Outcome outcome = hasFinished(candidate, now)
                    ? pastStatus(finishedIndex++, firstNoShow, secondNoShow)
                    : Outcome.UPCOMING;
            write(business, candidate, guestFor(written), noteFor(written), outcome, now);
            written++;
        }
        return written;
    }

    /**
     * Whether the appointment is over, which is <b>not</b> the same question as whether it started
     * in the past — and the difference is a crash rather than a cosmetic one.
     * {@link Booking#complete} refuses a booking that has not reached its {@code endsAt}, correctly:
     * a completed appointment in the future is a data-quality bug that resurfaces as a wrong number
     * on the dashboard. So the appointment straddling this instant is neither history nor a future
     * booking, and the honest thing to call it is {@code CONFIRMED} — somebody is in the chair.
     */
    private static boolean hasFinished(Candidate candidate, Instant now) {
        return !candidate.service().endFor(candidate.startsAt()).isAfter(now);
    }

    /**
     * Every appointment the seeder would like to write, in chronological order.
     *
     * <p>Two independent filters decide what survives, and both are structural rather than lucky.
     * A candidate is dropped unless its <em>blocked</em> range — the appointment widened by the
     * service's buffers, which is what the calendar actually loses — fits entirely inside one shift
     * of that staff member's template; a booking half outside working hours is a row the
     * availability engine would never have offered, and seeding one would make the demo contradict
     * itself on the first screen a reviewer opens. And a candidate on a closed date is dropped,
     * because a holiday with appointments in it is the same contradiction wearing a different hat.
     */
    private List<Candidate> candidates(List<Staff> staff, List<ServiceOffering> offerings,
            Closures closures) {
        LocalDate today = today();
        List<Candidate> candidates = new ArrayList<>();
        int considered = 0;

        for (int dayOffset = -HISTORY_DAYS; dayOffset <= FUTURE_DAYS; dayOffset++) {
            LocalDate date = today.plusDays(dayOffset);
            for (Staff member : staff) {
                if (closures.isClosed(member.user().getId(), date)) {
                    continue;
                }
                for (LocalTime slot : member.slots()) {
                    // A plain stride rather than a seeded random: the pattern is legible from the
                    // constant, there is no seed to explain, and the density cannot drift.
                    int index = considered++;
                    if (index % ONE_IN != 0) {
                        continue;
                    }
                    List<Integer> performs = member.serviceIndexes();
                    ServiceOffering service = offerings.get(performs.get(index / ONE_IN % performs.size()));
                    if (fitsInAShift(member, date, slot, service)) {
                        candidates.add(new Candidate(member, service, instantAt(date, slot)));
                    }
                }
            }
        }
        candidates.sort((left, right) -> left.startsAt().compareTo(right.startsAt()));
        return candidates;
    }

    /**
     * Whether the blocked range fits inside a single shift on that weekday.
     *
     * <p>One shift, not the union of them: the owner's Wednesday is 09:00–12:30 and 13:30–18:00, and
     * an appointment straddling the lunch break is exactly the row this has to refuse. Local times
     * throughout, because a shift is a wall-clock statement and the comparison has to happen before
     * the zone is applied.
     */
    private static boolean fitsInAShift(Staff staff, LocalDate date, LocalTime start,
            ServiceOffering service) {
        LocalTime blockedFrom = start.minusMinutes(service.getBufferBeforeMinutes());
        LocalTime blockedTo = start.plusMinutes(
                service.getDurationMinutes() + service.getBufferAfterMinutes());
        // A block that wraps past midnight cannot be compared this way, and none of the slots above
        // comes close to one; refusing it is cheaper than being subtly wrong about it.
        if (!blockedTo.isAfter(blockedFrom)) {
            return false;
        }
        return staff.shifts().stream().anyMatch(shift -> shift.day() == date.getDayOfWeek()
                && !blockedFrom.isBefore(shift.from())
                && !blockedTo.isAfter(shift.to()));
    }

    /** How a past appointment turned out, or that it has not happened yet. */
    private enum Outcome {
        UPCOMING, COMPLETED, CANCELLED, NO_SHOW
    }

    /**
     * A realistic mix: mostly kept, one in eight cancelled, and exactly two people who never turned
     * up. Every one of them is load-bearing for a dashboard figure — {@code COMPLETED} is the only
     * status that becomes revenue, {@code CANCELLED} is what proves the week count cannot be
     * inflated by churn, and the two no-shows are the numerator of a rate that would otherwise be
     * null.
     */
    private static Outcome pastStatus(long index, long firstNoShow, long secondNoShow) {
        if (index == firstNoShow || index == secondNoShow) {
            return Outcome.NO_SHOW;
        }
        return index % 8 == 5 ? Outcome.CANCELLED : Outcome.COMPLETED;
    }

    private void write(Business business, Candidate candidate, Guest guest, String notes,
            Outcome outcome, Instant now) {
        Booking booking = Booking.confirmed(business.getId(), candidate.service(),
                candidate.staff().user().getId(), candidate.startsAt(),
                new GuestContact(guest.name(), guest.email(), guest.phone()), notes);

        // The deposit is recorded on cancelled bookings too, and that is D7 rather than an
        // oversight: deposits are non-refundable, so the money stayed. The dashboard excludes
        // cancelled rows from its deposits figure on purpose, which is a different decision.
        booking.recordDepositPaid(business.depositFor(booking.getPriceCents()));

        switch (outcome) {
        case COMPLETED -> booking.complete(now);
        case CANCELLED -> booking.cancel();
        case NO_SHOW -> booking.markNoShow(now);
        // Stamped as already reminded, which is the one line here that looks like it is doing
        // the wrong thing. The reminder job runs on a schedule in the deployed demo and mails
        // every CONFIRMED booking starting within the next day — and these guests do not
        // exist, so that is a daily handful of bounces charged against the sender reputation
        // the real confirmation emails depend on. reminder_sent_at is exactly the flag that
        // makes the job skip a row, using the same idempotency it relies on to survive its own
        // overlapping window. Reminders are demonstrated by booking with your own address,
        // which is what the exit demo asks for.
        case UPCOMING -> booking.markReminderSent(now);
        }
        bookings.save(booking);
    }

    /** Most bookings have no note; a table where every row has one reads as generated. */
    private static String noteFor(int index) {
        return index % 5 == 3 ? NOTES.get((index / 5) % NOTES.size()) : null;
    }

    private static Guest guestFor(int index) {
        return GUESTS.get(index % GUESTS.size());
    }

    // ---------------------------------------------------------------------------------
    //  time
    // ---------------------------------------------------------------------------------

    /** Today in the salon's own zone, which is the only "today" a French salon has. */
    private LocalDate today() {
        return LocalDate.ofInstant(clock.instant(), ZONE);
    }

    /**
     * A wall-clock time in the business zone, resolved to an instant.
     *
     * <p>{@code ZonedDateTime.of} is what makes the seeded window cross a DST transition correctly
     * twice a year: 10:00 in Paris is 09:00 UTC in winter and 08:00 UTC in summer, and every
     * comparison downstream is between instants.
     */
    private static Instant instantAt(LocalDate date, LocalTime time) {
        return ZonedDateTime.of(date, time, ZONE).toInstant();
    }
}
