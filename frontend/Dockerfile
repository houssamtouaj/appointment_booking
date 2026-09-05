# =====================================================================================
# SlotFlow SPA — a build artifact, not a runtime.
#
# The final stage is `FROM scratch` and holds one directory: the compiled `dist/`. Nothing
# in it runs, and nothing is meant to. Ansible does `docker create` + `docker cp` to lift
# the files onto lb-01, where nginx serves them from disk and proxies /api to the app
# upstream. That is one origin, which is the whole reason VITE_API_BASE_URL is empty below.
#
# The alternative — an nginx image serving itself — means running nginx twice, once in the
# container and once as the reverse proxy in front of it, with two configs that have to keep
# agreeing about cache headers and SPA fallback. This shape has fewer moving parts and puts
# the static files on the host that was already going to serve them.
#
# Consequence worth knowing before it surprises someone: `docker run` on this image fails.
# It has no shell, no entrypoint and no base. That is not a broken build.
# =====================================================================================

# ------------------------------------ deps -------------------------------------------
# Its own stage so the dependency layer is invalidated by the lockfile alone, not by a
# source edit.
FROM node:22-alpine AS deps
WORKDIR /build

COPY package.json package-lock.json ./
# `ci`, never `install`. `ci` fails when package.json and package-lock.json disagree;
# `install` quietly rewrites the lockfile, and an image built from a lockfile that no longer
# matches the commit is an image nobody can reproduce.
RUN npm ci

# ------------------------------------ build ------------------------------------------
FROM node:22-alpine AS build
WORKDIR /build

COPY --from=deps /build/node_modules ./node_modules
COPY . .

# A17. Empty origin -> the client's relative /api/... requests -> same-origin behind
# lb-01's nginx. frontend/.env.example states the contract this relies on: "Origin of the
# SlotFlow API, no trailing slash. The app appends /api itself."
#
# Three things fall out of it. The tag stops being environment-specific, so A12's immutable
# tag means one thing rather than one thing per domain; this image stops waiting on the
# domain name, which is still open (OQ3); and none of the cross-origin machinery SlotFlow
# needs on Vercel+Render applies -- no CORS preflight, and the refresh cookie is same-site
# under the default Lax. REFRESH_COOKIE_SECURE=true is still required under HTTPS, but that
# is a runtime variable on the API, not a build argument here.
ARG VITE_API_BASE_URL=""
# The bare `/` route redirects to this slug, and the portfolio link has to land on something
# alive. An ARG rather than a hardcode, defaulted so the build stays reproducible with no
# build-args file.
ARG VITE_DEMO_SLUG=demo-salon
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_DEMO_SLUG=$VITE_DEMO_SLUG

# Only the build. No typecheck, no lint, no tests: ci.yml and web.yml already run those
# against a checkout that has the git metadata and config those tools read, and this
# .dockerignore deliberately drops some of it. It is the same reasoning backend/Dockerfile
# gives for skipping Spotless -- a packaging build is not the place for a source-hygiene
# gate, where a stray indent becomes a failed deploy.
RUN npm run build

# ------------------------------------- dist ------------------------------------------
# The artifact and nothing else. `docker cp` reads the layer directly without starting
# anything, so there is no need for a shell, a package manager or a base image -- and no CVE
# surface to patch on an image whose only job is to hold files.
#
# The stage name is load-bearing: release.yml builds `target: dist` explicitly rather than
# relying on last-stage-wins, so a stage appended later cannot silently change what ships.
FROM scratch AS dist
COPY --from=build /build/dist /dist
