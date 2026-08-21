package com.slotflow.availability;

import com.slotflow.common.error.ApiException;
import com.slotflow.common.error.ErrorCode;
import com.slotflow.staff.User;
import com.slotflow.staff.UserRepository;
import com.slotflow.tenant.TenantContext;
import jakarta.persistence.EntityNotFoundException;
import java.time.DayOfWeek;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The weekly template: read it, replace it.
 *
 * <h2>The authorisation rule, stated once</h2>
 * <b>An owner edits anyone in the tenant; a staff member edits only their own hours.</b> That is what
 * the use-case diagram's "manage <em>own</em> working hours" implies and the brief never wrote down,
 * and it is enforced here rather than in an annotation because it depends on the target row —
 * {@link TenantContext#requireOwnerOrSelf} is the same call the staff patch makes, for the same
 * reason.
 *
 * <p>The two verbs then part company on what a foreign id means, following the rule the whole API
 * follows: a read of somebody in another tenant is a 404, because a 403 would confirm the id exists;
 * a write is a 403, because the caller is authenticated and being refused.
 */
@Service
public class WorkingHoursService {

    private static final Logger log = LoggerFactory.getLogger(WorkingHoursService.class);

    private static final Comparator<WorkingHoursRange> BY_DAY_THEN_START =
            Comparator.comparing(WorkingHoursRange::dayOfWeek)
                    .thenComparing(WorkingHoursRange::startTime);

    private final WorkingHoursRepository workingHours;
    private final UserRepository users;
    private final TenantContext tenant;

    public WorkingHoursService(WorkingHoursRepository workingHours, UserRepository users,
                              TenantContext tenant) {
        this.workingHours = workingHours;
        this.users = users;
        this.tenant = tenant;
    }

    @Transactional(readOnly = true)
    public WorkingHoursResponse of(UUID staffId) {
        tenant.requireOwnerOrSelf(staffId);
        // Scoped by tenant in the query, so a foreign staff member is absent rather than forbidden.
        users.findByIdAndBusinessId(staffId, tenant.businessId())
                .orElseThrow(() -> new EntityNotFoundException("staff member " + staffId));
        return response(staffId, workingHours.findByStaffId(staffId));
    }

    /**
     * Deletes the week and writes the one in the request, in one transaction.
     *
     * <p><b>An identical body is a no-op</b>, and that is worth the comparison it costs. Without it,
     * every save of an unchanged grid deletes seven rows and inserts seven more with new ids and new
     * timestamps — churn that shows up as write load on the one table the availability engine reads
     * on every request, and that makes "did anything change?" unanswerable from the data.
     */
    @Transactional
    public WorkingHoursResponse replace(UUID staffId, WorkingHoursRequest request) {
        tenant.requireOwnerOrSelf(staffId);
        User staff = loadForWrite(staffId);

        List<WorkingHours> requested = validate(staffId, request.ranges());
        List<WorkingHours> current = workingHours.findByStaffId(staffId);
        if (sameWeek(current, requested)) {
            return response(staffId, current);
        }

        // Bulk delete then insert, rather than a diff: unlike a staff-service assignment, a range is
        // a row with values on it, so "the same week" is the only comparison worth making and it has
        // already been made above.
        workingHours.deleteByStaffId(staffId);
        List<WorkingHours> saved = workingHours.saveAll(requested);
        log.info("Replaced working hours for {} in business {}: {} range(s)",
                staffId, staff.getBusinessId(), saved.size());
        return response(staffId, saved);
    }

    // ---------------------------------------------------------------------------------
    //  validation
    // ---------------------------------------------------------------------------------

    /**
     * Turns the request into rows, refusing the two shapes the entity would otherwise refuse with an
     * {@code IllegalArgumentException} — which is a 500, on a form submission.
     *
     * <ul>
     *   <li>{@code endTime == startTime} says nothing at all, and the schema rejects it too. Earlier
     *       than {@code startTime} is a night shift and is accepted.</li>
     *   <li>Overlapping ranges leave the engine two answers about one minute. The message names the
     *       weekday, because the client's next action is to look at that row of the grid.</li>
     * </ul>
     *
     * <p>Both are reported as {@code errors[]} entries with an indexed path — {@code ranges[2]} — so
     * the editor can mark the offending row rather than the whole form.
     */
    private List<WorkingHours> validate(UUID staffId, List<WorkingHoursRange> ranges) {
        List<WorkingHours> rows = new ArrayList<>(ranges.size());
        for (int i = 0; i < ranges.size(); i++) {
            WorkingHoursRange range = ranges.get(i);
            if (range.startTime().equals(range.endTime())) {
                throw ApiException.invalidField("ranges[" + i + "].endTime",
                        "must differ from startTime; an earlier end means the shift crosses midnight");
            }
            rows.add(new WorkingHours(staffId, range.dayOfWeek(),
                    range.startTime(), range.endTime()));
        }

        WorkingHours.findOverlap(rows).ifPresent(day -> {
            throw new ApiException(ErrorCode.HOURS_OVERLAP,
                    "Two ranges overlap on " + friendly(day) + ".")
                    .with("dayOfWeek", day.name());
        });
        return rows;
    }

    // ---------------------------------------------------------------------------------
    //  helpers
    // ---------------------------------------------------------------------------------

    /** A write path: load by id, then guard, so a foreign id is refused rather than hidden. */
    private User loadForWrite(UUID staffId) {
        User staff = users.findById(staffId)
                .orElseThrow(() -> new EntityNotFoundException("staff member " + staffId));
        return tenant.requireOwnedForWrite(staff);
    }

    /**
     * Whether the stored week and the requested one are the same set of ranges.
     *
     * <p>A set, not a list: the order rows arrive in is not part of the template, so re-ordering the
     * same grid is still a no-op. Duplicates cannot survive the overlap check above, so collapsing
     * them here loses nothing.
     */
    private static boolean sameWeek(List<WorkingHours> current, List<WorkingHours> requested) {
        return keys(current).equals(keys(requested));
    }

    private static Set<String> keys(List<WorkingHours> ranges) {
        Set<String> keys = new LinkedHashSet<>();
        ranges.forEach(range -> keys.add(
                range.getDayOfWeek() + "/" + range.getStartTime() + "/" + range.getEndTime()));
        return keys;
    }

    private static WorkingHoursResponse response(UUID staffId, List<WorkingHours> ranges) {
        return new WorkingHoursResponse(staffId, ranges.stream()
                .map(range -> new WorkingHoursRange(
                        range.getDayOfWeek(), range.getStartTime(), range.getEndTime()))
                .sorted(BY_DAY_THEN_START)
                .toList());
    }

    /** {@code MONDAY} reads as shouting in a sentence a human is meant to read. */
    private static String friendly(DayOfWeek day) {
        String name = day.name();
        return name.charAt(0) + name.substring(1).toLowerCase(Locale.ROOT);
    }
}
