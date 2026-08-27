package com.slotflow.security;

import com.slotflow.common.error.ErrorCode;
import com.slotflow.common.error.ProblemDetailWriter;
import com.slotflow.common.error.Problems;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.http.ProblemDetail;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.stereotype.Component;

/**
 * The 403 for an authenticated request the filter chain itself refuses — the sibling of
 * {@link ProblemAuthenticationEntryPoint}, and there for the same reason: without it, the one
 * response in this API written by Spring Security rather than by us would have a different shape
 * from every other error.
 *
 * <p>Note which 403s this does <em>not</em> produce. A {@code @PreAuthorize} that fails inside a
 * controller or service throws into the dispatcher, where
 * {@link com.slotflow.common.error.GlobalExceptionHandler} handles it — the body is identical by
 * construction, because both paths build it through {@link Problems}. This handler covers the URL
 * rules in {@link SecurityConfig}.
 */
@Component
public class ProblemAccessDeniedHandler implements AccessDeniedHandler {

    private final ProblemDetailWriter problemWriter;

    public ProblemAccessDeniedHandler(ProblemDetailWriter problemWriter) {
        this.problemWriter = problemWriter;
    }

    @Override
    public void handle(HttpServletRequest request, HttpServletResponse response,
            AccessDeniedException deniedException) throws IOException {
        ProblemDetail problem = Problems.of(ErrorCode.ACCESS_DENIED,
                "You do not have permission to perform this action.");
        Problems.setInstance(problem, request.getRequestURI());
        problemWriter.write(response, problem);
    }
}
