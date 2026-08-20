package com.slotflow.common.web;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.slotflow.config.JacksonConfig;
import com.slotflow.config.PaginationConfig;
import com.slotflow.support.WebSliceConfig;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.data.domain.Pageable;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The two caps on {@code ?page=&size=}, asserted through the real argument resolver rather than
 * by reading the configuration back.
 *
 * <p>The clamp is the one that matters. {@code GET /api/bookings?size=100000} against a table
 * that grows forever is a one-line denial of service, and it is the kind of request a client
 * sends by accident while trying to "just get them all".
 */
// See ProblemDetailContractTest: scoped to the probe controller so the real ones stay out.
@WebMvcTest(controllers = PaginationTest.ProbeController.class)
@Import({PaginationTest.ProbeController.class, PaginationConfig.class, JacksonConfig.class,
        WebSliceConfig.class})
class PaginationTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    @DisplayName("no parameters means page 0 of 20, not an unbounded query")
    void defaultsToTwentyRows() throws Exception {
        mockMvc.perform(get("/test/pagination"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.size").value(PaginationConfig.DEFAULT_PAGE_SIZE));
    }

    @Test
    @DisplayName("a request within the cap is honoured exactly")
    void honoursARequestedSize() throws Exception {
        mockMvc.perform(get("/test/pagination").param("page", "3").param("size", "50"))
                .andExpect(jsonPath("$.page").value(3))
                .andExpect(jsonPath("$.size").value(50));
    }

    @Test
    @DisplayName("an oversized request is clamped to 100 rather than rejected")
    void clampsAnOversizedRequest() throws Exception {
        // Clamped, not 422: the caller wanted everything, and silently giving them the first
        // hundred is a more useful answer than a validation error they have to interpret.
        mockMvc.perform(get("/test/pagination").param("size", "100000"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.size").value(PaginationConfig.MAX_PAGE_SIZE));
    }

    @Test
    @DisplayName("page numbering is zero-based on the wire, matching PageResponse.page")
    void pagesAreZeroBased() throws Exception {
        mockMvc.perform(get("/test/pagination").param("page", "0"))
                .andExpect(jsonPath("$.page").value(0));
    }

    @RestController
    static class ProbeController {

        /** Echoes back what the resolver decided, which is the only thing under test here. */
        @GetMapping("/test/pagination")
        PageResponse<String> resolved(Pageable pageable) {
            return PageResponse.empty(pageable.getPageNumber(), pageable.getPageSize());
        }
    }
}
