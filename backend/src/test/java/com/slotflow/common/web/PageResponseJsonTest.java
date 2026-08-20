package com.slotflow.common.web;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.slotflow.config.JacksonConfig;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.skyscreamer.jsonassert.JSONAssert;
import org.skyscreamer.jsonassert.JSONCompareMode;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.json.JsonTest;
import org.springframework.context.annotation.Import;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;

/**
 * The paginated envelope from brief section 6, compared strictly.
 *
 * <p>Strict on purpose: this is the shape the React tables read, and the reason
 * {@link PageResponse} exists at all is that Spring's own {@code Page} serialisation is not a
 * contract. If somebody later returns a raw {@code Page} from a controller, the response gains
 * {@code pageable}, {@code sort}, {@code first}, {@code last} and {@code numberOfElements}, and
 * this test is the one that says so out loud.
 */
@JsonTest
@Import(JacksonConfig.class)
class PageResponseJsonTest {

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    @DisplayName("the JSON has exactly the five members the brief documents, and no others")
    void serialisesExactlyTheDocumentedShape() throws Exception {
        Page<String> page = new PageImpl<>(List.of("first", "second"), PageRequest.of(1, 2), 7);

        String json = objectMapper.writeValueAsString(PageResponse.of(page));

        JSONAssert.assertEquals("""
                {
                  "content": ["first", "second"],
                  "page": 1,
                  "size": 2,
                  "totalElements": 7,
                  "totalPages": 4
                }
                """, json, JSONCompareMode.STRICT);
    }

    @Test
    @DisplayName("an empty page still carries content as an empty array, never as a missing member")
    void emptyPageKeepsTheContentMember() throws Exception {
        // NON_NULL inclusion is configured globally; an empty list is not null, and a client
        // iterating `content` must not have to null-check it.
        String json = objectMapper.writeValueAsString(PageResponse.empty(0, 20));

        JSONAssert.assertEquals("""
                { "content": [], "page": 0, "size": 20, "totalElements": 0, "totalPages": 0 }
                """, json, JSONCompareMode.STRICT);
    }

    @Test
    @DisplayName("the mapping overload converts rows without exposing what the repository returned")
    void mapsRowsOnTheWayOut() {
        Page<Integer> entities = new PageImpl<>(List.of(1, 2, 3), PageRequest.of(0, 20), 3);

        PageResponse<String> response = PageResponse.of(entities, value -> "row-" + value);

        assertThat(response.content()).containsExactly("row-1", "row-2", "row-3");
        assertThat(response.totalElements()).isEqualTo(3);
        assertThat(response.totalPages()).isEqualTo(1);
    }
}
