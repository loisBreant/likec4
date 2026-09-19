# Stage 1: Build LikeC4 from the checked-out source.
# This is the default image target so local images include unpublished changes.
FROM node:22.22.3-bookworm AS likec4-source

WORKDIR /workspace
COPY . .

RUN corepack enable && \
    pnpm install --frozen-lockfile && \
    pnpm generate && \
    pnpm typecheck && \
    pnpm --filter likec4... build && \
    pnpm --filter likec4 pack && \
    mv likec4-*.tgz /tmp/likec4.tgz

# Stage 2: Build Graphviz
FROM node:22.22.3-bookworm AS graphviz

ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV DEBIAN_FRONTEND=noninteractive

# Build Graphviz from source because there are no binary distributions for recent versions
# Copied from https://github.com/plantuml/plantuml/blob/51f3b45e37735085a87dff9eb1a0cf986f9719d2/Dockerfile
ARG GRAPHVIZ_VERSION
ARG GRAPHVIZ_BUILD_DIR=/tmp/graphiz-build
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        build-essential \
        jq \
        libexpat1-dev \
        libgd-dev \
        zlib1g-dev \
        curl \
        cmake \
        pkg-config \
        libtool && \
    mkdir -p $GRAPHVIZ_BUILD_DIR && \
    cd $GRAPHVIZ_BUILD_DIR && \
    GRAPHVIZ_VERSION=${GRAPHVIZ_VERSION:-$(curl -s https://gitlab.com/api/v4/projects/4207231/releases/ | jq -r '.[] | .name' | sort -V -r | head -1)} && \
    echo "Graphviz version: $GRAPHVIZ_VERSION" && \
    curl -o graphviz.tar.gz https://gitlab.com/api/v4/projects/4207231/packages/generic/graphviz-releases/${GRAPHVIZ_VERSION}/graphviz-${GRAPHVIZ_VERSION}.tar.gz && \
    tar -xzf graphviz.tar.gz && \
    cd graphviz-$GRAPHVIZ_VERSION && \
    ./configure && \
    make && \
    make install DESTDIR=/install && \
    ldconfig

# Stage 3: Create the common runner image
FROM node:22.22.3-bookworm-slim AS runner

ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV DEBIAN_FRONTEND=noninteractive

# Copy Graphviz binaries
COPY --from=graphviz /install /

# Overridden by .github/workflows/docker.yaml with the exact version likec4 depends on.
# Keep this default in sync with the `playwright` catalog entry in pnpm-workspace.yaml.
ARG PLAYWRIGHT_VER=1.60.0
# Install runtime dependencies
RUN apt-get update && \
    apt-get install --no-install-recommends -y \
        fonts-dejavu \
        libexpat1 \
        libgd3 \
        libpango-1.0-0 \
        libpangocairo-1.0-0 \
        libcairo2 \
        libglib2.0-0 \
        libltdl7 \
        libpango-1.0-0 \
        libgts-bin \
        libgtk2.0-bin \
        curl && \
    # Verify installation
    dot -V && \
    dot -c && \
    # Install Playwright
    npx -y playwright@${PLAYWRIGHT_VER} install chromium --with-deps && \
    apt-get autoremove && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* && \
    rm -rf /root/.npm

# Stage 4: Common application configuration
FROM runner AS app

ENV NODE_ENV=production
WORKDIR /data

ENTRYPOINT ["/usr/local/bin/likec4"]
CMD ["-h"]

# Default ports
EXPOSE 5173 24678

# Install LikeC4 from the published registry. The release workflow targets
# this stage so release images keep their existing registry-based behavior.
FROM app AS registry

ARG LIKEC4_VER=latest
RUN npm install -g likec4@${LIKEC4_VER} && \
    rm -rf /root/.npm

# Install LikeC4 from the source stage. This target is deliberately last so a
# plain `docker build` produces an image containing the current checkout.
FROM app AS source

COPY --from=likec4-source /tmp/likec4.tgz /tmp/likec4.tgz
RUN npm install -g /tmp/likec4.tgz && \
    rm -rf /root/.npm /tmp/likec4.tgz
