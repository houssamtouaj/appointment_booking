package com.slotflow.common.web;

import java.util.List;
import java.util.function.Function;
import org.springframework.data.domain.Page;

/**
 * The paginated envelope from brief section 6: {@code content}, {@code page}, {@code size},
 * {@code totalElements}, {@code totalPages}. Five members, in that order, and nothing else.
 *
 * <p>Never return a Spring {@code Page} from a controller. Its JSON shape is not part of
 * Spring Data's API contract, it changed between Boot minor versions, and it leaks
 * {@code pageable} and {@code sort} internals that mean nothing to a client. Boot 3.3 even
 * logs a warning when it serialises one. This record is the whole reason that never bites.
 *
 * @param content       the rows on this page, already mapped to DTOs
 * @param page          zero-based page index, matching the {@code ?page=} the client sent
 * @param size          the page size actually applied, which may be smaller than requested
 * @param totalElements rows across every page
 * @param totalPages    zero when there are no rows at all
 */
public record PageResponse<T>(
        List<T> content,
        int page,
        int size,
        long totalElements,
        int totalPages) {

    public static <T> PageResponse<T> of(Page<T> page) {
        return new PageResponse<>(page.getContent(), page.getNumber(), page.getSize(),
                page.getTotalElements(), page.getTotalPages());
    }

    /**
     * The overload every controller actually wants: pages come out of a repository holding
     * entities, and entities must never reach the wire. Passing the mapper here keeps the
     * conversion on one line instead of a {@code page.map(...)} dance at each call site.
     */
    public static <E, T> PageResponse<T> of(Page<E> page, Function<? super E, ? extends T> mapper) {
        return new PageResponse<>(page.getContent().stream().<T>map(mapper::apply).toList(),
                page.getNumber(), page.getSize(), page.getTotalElements(), page.getTotalPages());
    }

    /** For the empty case where no query was run at all, so there is no {@code Page} to wrap. */
    public static <T> PageResponse<T> empty(int page, int size) {
        return new PageResponse<>(List.of(), page, size, 0L, 0);
    }
}
