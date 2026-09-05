# =====================================================================================
# SlotFlow API — multi-stage build.
# Stage 1 resolves dependencies in their own layer so a source-only change does not
# re-download the world; stage 2 keeps nothing but a JRE and the jar.
# =====================================================================================

# ------------------------------------ build ------------------------------------------
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build

# Dependency layer: invalidated only when pom.xml changes.
COPY pom.xml ./
RUN mvn -B -ntp dependency:go-offline

# Source layer.
COPY src ./src

# Spotless is skipped here, and only here. It is bound to `validate`, so it would
# otherwise run on every image build - and it cannot succeed in this context. Its
# config names ${project.basedir}/eclipse-formatter.xml, which sits beside the POM and
# is not copied in; its lineEndings policy is GIT_ATTRIBUTES, and .gitattributes lives
# at the repository root, one level above `context: ./backend`, while .dockerignore
# drops .git/ on purpose. Copying all three in would only move a source-hygiene gate
# into a packaging build, where a stray indent becomes a failed deploy.
#
# The check is not lost: ci.yml runs `./mvnw -B -ntp verify` on every push, against a
# checkout that has the formatter file and the git metadata the policy reads.
RUN mvn -B -ntp clean package -DskipTests -Dspotless.check.skip=true \
    && mv target/*.jar target/app.jar

# ----------------------------------- runtime -----------------------------------------
FROM eclipse-temurin:21-jre-alpine AS runtime

RUN addgroup -S slotflow && adduser -S -G slotflow -h /app slotflow
WORKDIR /app

COPY --from=build --chown=slotflow:slotflow /build/target/app.jar ./app.jar

USER slotflow
EXPOSE 8080

# Containers get a slice of the host, not the whole machine: let the JVM see the cgroup limit.
ENV JAVA_OPTS="-XX:MaxRAMPercentage=75.0 -XX:+ExitOnOutOfMemoryError -Duser.timezone=UTC"

# The actuator has its own port, so this probes the management port and not the API one -
# /actuator/health is a 404 on the API port and a probe pointed there marks every healthy
# container unhealthy. The chain mirrors how application.yml resolves it: MANAGEMENT_SERVER_PORT,
# and 9090 when unset. Where a platform folds the two together by setting MANAGEMENT_SERVER_PORT
# to the routed port, this follows it to the same place.
#
# `localhost` regardless of MANAGEMENT_SERVER_ADDRESS: the probe runs inside the container, so it
# reaches a loopback bind and an all-interfaces one alike.
HEALTHCHECK --interval=15s --timeout=3s --start-period=45s --retries=5 \
    CMD wget -qO- "http://localhost:${MANAGEMENT_SERVER_PORT:-9090}/actuator/health" \
        | grep -q '"status":"UP"' || exit 1

ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar /app/app.jar"]
