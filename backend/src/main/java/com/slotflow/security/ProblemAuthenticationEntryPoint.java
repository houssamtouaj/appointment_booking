package com.slotflow.security;

import com.slotflow.common.error.ErrorCode;
import com.slotflow.common.error.ProblemDetailWriter;
import com.slotflow.common.error.Problems;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.http.ProblemDetail;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.stereotype.Component;

/**
 * The 401 for a request that reached a protected endpoint without a usable token.
 *
 * <p>This class exists because of where it runs. Spring Security's chain is a servlet filter, so it
 * is finished with the request long before the {@code DispatcherServlet} and its
 * {@code @RestControllerAdvice} would see it — which means the default entry point's empty body
 * with a {@code WWW-Authenticate} header would be the one response in this API that is not a
 * problem detail. Plan 04 flagged it; this is the fix, and it goes through the same
 * {@link Problems} factory as everything else so the shape cannot drift.
 *
 * <p>The detail is deliberately incurious: it does not say whether a token was absent, expired or
 * forged. A client's response to all three is the same — refresh, then re-authenticate.
 */
@Component
public class ProblemAuthenticationEntryPoint implements AuthenticationEntryPoint {

    private final ProblemDetailWriter problemWriter;

    public ProblemAuthenticationEntryPoint(ProblemDetailWriter problemWriter) {
        this.problemWriter = problemWriter;
    }

    @Override
    public void commence(HttpServletRequest request, HttpServletResponse response,
            AuthenticationException authException) throws IOException {
        ProblemDetail problem = Problems.of(ErrorCode.UNAUTHENTICATED,
                "Authentication is required to access this resource.");
        Problems.setInstance(problem, request.getRequestURI());
        problemWriter.write(response, problem);
    }
}
