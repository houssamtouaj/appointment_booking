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
RUN mvn -B -ntp clean package -DskipTests \
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

# The port is resolved the same way application.yml resolves it - SERVER_PORT, then the
# platform's PORT, then 8080 - because a probe that hardcodes 8080 reports a perfectly
# healthy container as unhealthy the moment either variable is set, which is the normal
# case on Railway, Render and Fly.
HEALTHCHECK --interval=15s --timeout=3s --start-period=45s --retries=5 \
    CMD wget -qO- "http://localhost:${SERVER_PORT:-${PORT:-8080}}/actuator/health" \
        | grep -q '"status":"UP"' || exit 1

ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar /app/app.jar"]
