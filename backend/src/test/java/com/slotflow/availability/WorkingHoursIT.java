package com.slotflow.availability;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.slotflow.staff.User;
import com.slotflow.support.ApiIntegrationTest;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * {@code /api/staff/{id}/working-hours}: the full-week replace, the shapes that are legal, the
 * shapes that are not, and the authorisation rule the brief never wrote down.
 */
class WorkingHoursIT extends ApiIntegrationTest {

    @Autowired
    private WorkingHoursRepository workingHours;

    // ---------------------------------------------------------------------------------
    //  the replace
    // ---------------------------------------------------------------------------------

    @Test
    @DisplayName("PUT replaces the whole week, split shift and night shift included")
    void thePutReplacesTheWholeWeek() throws Exception {
        Tenant tenant = aTenant();

        mockMvc.perform(asOwner(put(hours(tenant.owner())), tenant, """
                        {"ranges": [
                          {"dayOfWeek": "MONDAY",   "startTime": "09:00", "endTime": "12:00"},
                          {"dayOfWeek": "MONDAY",   "startTime": "13:00", "endTime": "17:00"},
                          {"dayOfWeek": "SATURDAY", "startTime": "22:00", "endTime": "02:00"}
                        ]}
                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.staffId").value(tenant.owner().getId().toString()))
                .andExpect(jsonPath("$.ranges.length()").value(3))
                // Monday first, then by start time: the order the grid is drawn in and the order a
                // split shift is worked.
                .andExpect(jsonPath("$.ranges[0].dayOfWeek").value("MONDAY"))
                .andExpect(jsonPath("$.ranges[0].startTime").value("09:00:00"))
                .andExpect(jsonPath("$.ranges[1].startTime").value("13:00:00"))
                // 22:00-02:00 is a night shift, not a typo, and the gate asks for it explicitly.
                .andExpect(jsonPath("$.ranges[2].dayOfWeek").value("SATURDAY"))
                .andExpect(jsonPath("$.ranges[2].endTime").value("02:00:00"));

        // A replace, not a merge: the second body has no Saturday, so Saturday is not worked.
        mockMvc.perform(asOwner(put(hours(tenant.owner())), tenant, """
                        {"ranges": [
                          {"dayOfWeek": "TUESDAY", "startTime": "10:00", "endTime": "16:00"}
                        ]}
                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ranges.length()").value(1))
                .andExpect(jsonPath("$.ranges[0].dayOfWeek").value("TUESDAY"));

        mockMvc.perform(asOwner(get(hours(tenant.owner())), tenant, null))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ranges.length()").value(1));
    }

    @Test
    @DisplayName("a second identical PUT changes nothing at all, not even the rows")
    void anIdenticalPutIsANoOp() throws Exception {
        Tenant tenant = aTenant();
        String week = """
                {"ranges": [
                  {"dayOfWeek": "MONDAY", "startTime": "09:00", "endTime": "17:00"},
                  {"dayOfWeek": "TUESDAY", "startTime": "09:00", "endTime": "17:00"}
                ]}
                """;

        mockMvc.perform(asOwner(put(hours(tenant.owner())), tenant, week))
                .andExpect(status().isOk());
        Set<UUID> first = rowIds(tenant.owner());

        mockMvc.perform(asOwner(put(hours(tenant.owner())), tenant, week))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ranges.length()").value(2));

        // The same ids, which is the strong form of "no-op": without the comparison in the service
        // this saves seven rows and deletes seven on every visit to the editor, against the one
        // table the availability engine reads on every request.
        assertThat(rowIds(tenant.owner())).isEqualTo(first);
    }

    @Test
    @DisplayName("re-ordering the same ranges is still a no-op")
    void orderIsNotPartOfTheTemplate() throws Exception {
        Tenant tenant = aTenant();
        mockMvc.perform(asOwner(put(hours(tenant.owner())), tenant, """
                        {"ranges": [
                          {"dayOfWeek": "MONDAY", "startTime": "09:00", "endTime": "12:00"},
                          {"dayOfWeek": "MONDAY", "startTime": "13:00", "endTime": "17:00"}
                        ]}
                        """))
                .andExpect(status().isOk());
        Set<UUID> first = rowIds(tenant.owner());

        mockMvc.perform(asOwner(put(hours(tenant.owner())), tenant, """
                        {"ranges": [
                          {"dayOfWeek": "MONDAY", "startTime": "13:00", "endTime": "17:00"},
                          {"dayOfWeek": "MONDAY", "startTime": "09:00", "endTime": "12:00"}
                        ]}
                        """))
                .andExpect(status().isOk());

        assertThat(rowIds(tenant.owner())).isEqualTo(first);
    }

    @Test
    @DisplayName("an empty week is a legal body: this person works no fixed hours")
    void anEmptyWeekClearsTheTemplate() throws Exception {
        Tenant tenant = aTenant();
        mockMvc.perform(asOwner(put(hours(tenant.owner())), tenant, """
                        {"ranges": [{"dayOfWeek": "MONDAY", "startTime": "09:00", "endTime": "17:00"}]}
                        """))
                .andExpect(status().isOk());

        mockMvc.perform(asOwner(put(hours(tenant.owner())), tenant, """
                        {"ranges": []}
                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ranges.length()").value(0));
        assertThat(workingHours.findByStaffId(tenant.owner().getId())).isEmpty();
    }

    // ---------------------------------------------------------------------------------
    //  the shapes that are refused
    // ---------------------------------------------------------------------------------

    @Test
    @DisplayName("two ranges overlapping on one day is 422 HOURS_OVERLAP, naming the day")
    void overlappingRangesInOneDayAreRefused() throws Exception {
        Tenant tenant = aTenant();

        mockMvc.perform(asOwner(put(hours(tenant.owner())), tenant, """
                        {"ranges": [
                          {"dayOfWeek": "WEDNESDAY", "startTime": "09:00", "endTime": "13:00"},
                          {"dayOfWeek": "WEDNESDAY", "startTime": "12:00", "endTime": "17:00"}
                        ]}
                        """))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("HOURS_OVERLAP"))
                .andExpect(jsonPath("$.dayOfWeek").value("WEDNESDAY"));

        // Nothing was written: the validation runs before the delete, so a rejected save cannot
        // leave the week emptier than it started.
        assertThat(workingHours.findByStaffId(tenant.owner().getId())).isEmpty();
    }

    @Test
    @DisplayName("a night shift that runs into the next day's range is refused too")
    void overlapIsCheckedAcrossMidnight() throws Exception {
        Tenant tenant = aTenant();

        // Monday 22:00 to Tuesday 02:00, and a Tuesday shift starting at 01:00. Neither range
        // overlaps anything "within a day", and the staff member is nonetheless working the same
        // hour twice. Storing both would hand the engine two answers about Tuesday 01:00.
        mockMvc.perform(asOwner(put(hours(tenant.owner())), tenant, """
                        {"ranges": [
                          {"dayOfWeek": "MONDAY",  "startTime": "22:00", "endTime": "02:00"},
                          {"dayOfWeek": "TUESDAY", "startTime": "01:00", "endTime": "03:00"}
                        ]}
                        """))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("HOURS_OVERLAP"))
                .andExpect(jsonPath("$.dayOfWeek").value("TUESDAY"));
    }

    @Test
    @DisplayName("ranges that merely touch are adjacent, not overlapping")
    void touchingRangesAreAccepted() throws Exception {
        Tenant tenant = aTenant();

        // Half-open intervals, the same convention the booking exclusion constraint uses. Without
        // it a split shift with no gap — a shop that changes staff at noon — could not be expressed.
        mockMvc.perform(asOwner(put(hours(tenant.owner())), tenant, """
                        {"ranges": [
                          {"dayOfWeek": "THURSDAY", "startTime": "09:00", "endTime": "12:00"},
                          {"dayOfWeek": "THURSDAY", "startTime": "12:00", "endTime": "17:00"}
                        ]}
                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ranges.length()").value(2));
    }

    @Test
    @DisplayName("a range that starts and ends at the same time names the row it came from")
    void aZeroLengthRangeIsRefused() throws Exception {
        Tenant tenant = aTenant();

        mockMvc.perform(asOwner(put(hours(tenant.owner())), tenant, """
                        {"ranges": [
                          {"dayOfWeek": "FRIDAY", "startTime": "09:00", "endTime": "17:00"},
                          {"dayOfWeek": "FRIDAY", "startTime": "18:00", "endTime": "18:00"}
                        ]}
                        """))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                // The indexed path, so the editor can mark the second row rather than the form.
                .andExpect(jsonPath("$.errors[0].field").value("ranges[1].endTime"));
    }

    @Test
    @DisplayName("a range missing a field is a 422 from the binder, not a 500")
    void anIncompleteRangeIsRefused() throws Exception {
        Tenant tenant = aTenant();

        mockMvc.perform(asOwner(put(hours(tenant.owner())), tenant, """
                        {"ranges": [{"dayOfWeek": "MONDAY", "startTime": "09:00"}]}
                        """))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.errors[0].field").value("ranges[0].endTime"));

        mockMvc.perform(asOwner(put(hours(tenant.owner())), tenant, """
                        {}
                        """))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errors[0].field").value("ranges"));
    }

    // ---------------------------------------------------------------------------------
    //  the authorisation rule
    // ---------------------------------------------------------------------------------

    @Test
    @DisplayName("a staff member edits their own hours and nobody else's")
    void staffEditOnlyTheirOwn() throws Exception {
        Tenant tenant = aTenant();
        User colleague = aStaffMemberOf(tenant);
        String week = """
                {"ranges": [{"dayOfWeek": "MONDAY", "startTime": "09:00", "endTime": "17:00"}]}
                """;

        // Their own: 200. This is the "manage own working hours" the use-case diagram implies and
        // the brief never spelled out.
        mockMvc.perform(as(put(hours(colleague)), colleague, week))
                .andExpect(status().isOk());

        // Somebody else's: 403, on the write and on the read. Refused rather than quietly ignored.
        mockMvc.perform(as(put(hours(tenant.owner())), colleague, week))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCESS_DENIED"));
        mockMvc.perform(as(get(hours(tenant.owner())), colleague, null))
                .andExpect(status().isForbidden());

        // And an owner edits anyone in the tenant, which is the other half of the rule.
        mockMvc.perform(asOwner(put(hours(colleague)), tenant, """
                        {"ranges": [{"dayOfWeek": "SUNDAY", "startTime": "11:00", "endTime": "15:00"}]}
                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ranges[0].dayOfWeek").value("SUNDAY"));
    }

    // ---------------------------------------------------------------------------------
    //  helpers
    // ---------------------------------------------------------------------------------

    private Set<UUID> rowIds(User staff) {
        return workingHours.findByStaffId(staff.getId()).stream()
                .map(WorkingHours::getId)
                .collect(Collectors.toSet());
    }

    private static String hours(User staff) {
        return "/api/staff/" + staff.getId() + "/working-hours";
    }

    private MockHttpServletRequestBuilder asOwner(MockHttpServletRequestBuilder request,
            Tenant tenant, String body) {
        return as(request, tenant.owner(), body);
    }

    private MockHttpServletRequestBuilder as(MockHttpServletRequestBuilder request, User caller,
            String body) {
        request.header(HttpHeaders.AUTHORIZATION, bearer(caller));
        if (body != null) {
            request.contentType(MediaType.APPLICATION_JSON).content(body);
        }
        return request;
    }
}
