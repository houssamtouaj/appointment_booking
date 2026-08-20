package com.slotflow.common.error;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.slotflow.config.JacksonConfig;
import com.slotflow.support.WebSliceConfig;
import jakarta.persistence.EntityNotFoundException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.json.JsonCompareMode;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The error contract, asserted against the real MVC stack.
 *
 * <p>The 422 body below is the one the React forms parse, so it is compared <b>strictly</b>: an
 * extra member, a renamed key or a reordered {@code errors[]} fails this test. That is the point.
 * Every form and every toast downstream is written against these exact keys, and a contract
 * nobody asserts on is a contract that drifts.
 *
 * <p>The controller is a nested class registered explicitly rather than a placeholder endpoint in
 * {@code src/main}: shipping a route whose only purpose is to fail validation would put it in the
 * OpenAPI document and in the deployed demo. Nested and unannotated at the class level means
 * component scanning cannot reach it, so it exists here and nowhere else.
 */
@WebMvcTest
@Import({ProblemDetailContractTest.ProbeController.class, JacksonConfig.class, WebSliceConfig.class})
class ProblemDetailContractTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    @DisplayName("a malformed request body returns exactly the 422 problem body from brief section 6")
    void malformedRequestReturnsTheDocumented422Body() throws Exception {
        // Two failures at once, deliberately: errors[] has to list every problem with the
        // request, not the first one Hibernate Validator happened to reach.
        String body = """
                { "name": "  ", "durationMinutes": 4000 }
                """;

        mockMvc.perform(post("/test/problems/services")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(content().json("""
                        {
                          "type": "https://slotflow.dev/problems/validation-failed",
                          "title": "Validation failed",
                          "status": 422,
                          "detail": "The request contains invalid fields. See errors for the details.",
                          "instance": "/test/problems/services",
                          "code": "VALIDATION_FAILED",
                          "errors": [
                            { "field": "durationMinutes", "message": "must be less than or equal to 480" },
                            { "field": "name", "message": "must not be blank" }
                          ]
                        }
                        """, JsonCompareMode.STRICT));
    }

    @Test
    @DisplayName("errors[] is sorted by field, so the contract test cannot flake on validator order")
    void validationErrorsAreSorted() throws Exception {
        mockMvc.perform(post("/test/problems/services")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errors.length()").value(2))
                .andExpect(jsonPath("$.errors[0].field").value("durationMinutes"))
                .andExpect(jsonPath("$.errors[1].field").value("name"));
    }

    @Test
    @DisplayName("an ApiException carries its own code, status and extra members into the body")
    void apiExceptionShapesItsOwnProblem() throws Exception {
        mockMvc.perform(post("/test/problems/conflict"))
                .andExpect(status().isConflict())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("BOOKING_SLOT_TAKEN"))
                .andExpect(jsonPath("$.title").value("Slot already booked"))
                .andExpect(jsonPath("$.status").value(409))
                .andExpect(jsonPath("$.detail").value("That slot was taken while you were deciding."))
                // The extra member is what lets the client refetch the right day instead of
                // reloading the whole calendar.
                .andExpect(jsonPath("$.requestedStart").value("2026-03-02T09:00:00Z"));
    }

    @Test
    @DisplayName("a cross-tenant read is a 404, so no foreign id is ever confirmed to exist")
    void entityNotFoundIs404() throws Exception {
        mockMvc.perform(get("/test/problems/missing"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND"))
                .andExpect(jsonPath("$.type").value("https://slotflow.dev/problems/not-found"));
    }

    @Test
    @DisplayName("a denied write is a 403 with the same envelope as everything else")
    void accessDeniedIs403() throws Exception {
        mockMvc.perform(post("/test/problems/denied"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCESS_DENIED"));
    }

    @Test
    @DisplayName("a 500 leaks no internals and quotes back the request id from the log lines")
    void unexpectedFailureIs500WithoutInternals() throws Exception {
        mockMvc.perform(get("/test/problems/boom")
                        .header("X-Request-Id", "trace-me-42"))
                .andExpect(status().isInternalServerError())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("INTERNAL_ERROR"))
                .andExpect(jsonPath("$.detail")
                        .value("Something went wrong on our side. Quote the request id if you report this."))
                // The same token the log line carries, which is the entire point of having it.
                .andExpect(jsonPath("$.requestId").value("trace-me-42"))
                .andExpect(header().string("X-Request-Id", "trace-me-42"))
                // Nothing from the exception itself reaches the caller.
                .andExpect(content().string(not(containsString("deliberate"))))
                .andExpect(jsonPath("$.trace").doesNotExist())
                .andExpect(jsonPath("$.exception").doesNotExist());
    }

    @Test
    @DisplayName("4xx bodies carry no request id, so they stay assertable byte for byte")
    void clientErrorsHaveNoRequestIdInTheBody() throws Exception {
        mockMvc.perform(get("/test/problems/missing").header("X-Request-Id", "trace-me-43"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.requestId").doesNotExist())
                .andExpect(header().string("X-Request-Id", "trace-me-43"));
    }

    @Test
    @DisplayName("an unparseable body is a 400, not a 422: nothing got as far as validation")
    void unreadableBodyIs400() throws Exception {
        mockMvc.perform(post("/test/problems/services")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{ not json"))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("MALFORMED_REQUEST"));
    }

    @Test
    @DisplayName("an unknown property is rejected rather than silently dropped")
    void unknownPropertyIsRejected() throws Exception {
        mockMvc.perform(post("/test/problems/services")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                { "name": "Consultation", "durationMinutes": 60, "prcie": 5000 }
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("MALFORMED_REQUEST"));
    }

    @Test
    @DisplayName("a status Spring produced on its own is still inside the contract")
    void frameworkErrorsGetACodeToo() throws Exception {
        mockMvc.perform(get("/test/problems/services"))
                .andExpect(status().isMethodNotAllowed())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("METHOD_NOT_ALLOWED"))
                .andExpect(jsonPath("$.title").value("Method not allowed"));
    }

    @Test
    @DisplayName("a failed parameter constraint is a 422 with the parameter named")
    void invalidQueryParameterIs422() throws Exception {
        mockMvc.perform(get("/test/problems/paged").param("size", "-1"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.errors[0].field").value("size"));
    }

    @Test
    @DisplayName("a successful response is correlated too, not only the failures")
    void requestIdIsEchoedOnSuccess() throws Exception {
        mockMvc.perform(get("/test/problems/ok"))
                .andExpect(status().isOk())
                .andExpect(header().exists("X-Request-Id"));
    }

    // ---------------------------------------------------------------------------------
    //  the probe controller: exists only for this test
    // ---------------------------------------------------------------------------------

    @RestController
    @RequestMapping("/test/problems")
    static class ProbeController {

        record ServiceRequest(
                @NotBlank String name,
                @Min(5) @Max(480) int durationMinutes) {
        }

        @PostMapping("/services")
        String create(@Valid @RequestBody ServiceRequest request) {
            return request.name();
        }

        @PostMapping("/conflict")
        String conflict() {
            throw new ApiException(ErrorCode.BOOKING_SLOT_TAKEN,
                    "That slot was taken while you were deciding.")
                    .with("requestedStart", "2026-03-02T09:00:00Z");
        }

        @GetMapping("/missing")
        String missing() {
            throw new EntityNotFoundException("Booking " + UUID.randomUUID() + " not found");
        }

        @PostMapping("/denied")
        String denied() {
            throw new AccessDeniedException("cross-tenant write");
        }

        @GetMapping("/boom")
        String boom() {
            throw new IllegalStateException("deliberate failure with an internal message");
        }

        @GetMapping("/paged")
        String paged(@RequestParam @Positive int size) {
            return String.valueOf(size);
        }

        @GetMapping("/ok")
        String ok() {
            return "ok";
        }
    }
}
