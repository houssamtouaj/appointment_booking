package com.slotflow;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/**
 * SlotFlow API entry point.
 *
 * <p>The schema is owned by Flyway ({@code db/migration}); Hibernate only validates it.
 * Every instant is stored and served in UTC.
 */
@SpringBootApplication
@ConfigurationPropertiesScan
public class SlotflowApplication {

    public static void main(String[] args) {
        SpringApplication.run(SlotflowApplication.class, args);
    }
}
