package com.slotflow.common.error;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.stereotype.Component;

/**
 * Writes a problem body straight onto the response, for the code that runs outside the
 * DispatcherServlet and so cannot reach {@link GlobalExceptionHandler}: the servlet filters
 * in {@code common.web}, and from plan 05 the security chain's entry point and access-denied
 * handler.
 *
 * <p>The {@code ObjectMapper} is the application's own, so a body written here is byte-for-byte
 * the same shape as one written by the advice.
 */
@Component
public class ProblemDetailWriter {

    private final ObjectMapper objectMapper;

    public ProblemDetailWriter(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public void write(HttpServletResponse response, ProblemDetail problem) throws IOException {
        // Nothing sensible left to do if the response is already on the wire; overwriting the
        // status would throw and mask whatever actually went wrong.
        if (response.isCommitted()) {
            return;
        }
        response.setStatus(problem.getStatus());
        // No explicit charset. Spring MVC does not add one when it writes a ProblemDetail, and a
        // body from here has to be indistinguishable from one written by the advice — including
        // its Content-Type. JSON is UTF-8 by specification, and Jackson writes UTF-8 to a stream.
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        objectMapper.writeValue(response.getOutputStream(), problem);
    }
}
