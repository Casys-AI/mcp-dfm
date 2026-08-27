# mcp-dfm — Stateless MCP server for DFM geometry checks (port 3018).
#
# Runtime deps:
#   - gmsh     : STEP → surface STL tessellation (all three tools)
#   - python3  : thickness ray-casting script (dfm_check_min_thickness only)
#   - python3-numpy : Möller-Trumbore intersection (no trimesh)
#
# The server defaults to 127.0.0.1; --hostname=0.0.0.0 is a legitimate CLI
# flag already implemented in server.ts and used here to make the container
# reachable from outside.

FROM denoland/deno:debian

# Install system-level runtime dependencies.
# python3-numpy pulls python3 as a dependency; we name it explicitly for clarity.
# --no-install-recommends keeps the layer lean.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       gmsh \
       python3 \
       python3-numpy \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy manifests first so the dependency-cache layer can be reused when only
# source files change.
COPY deno.json deno.lock ./

# Copy all source needed for deno cache (local imports must resolve).
COPY mod.ts server.ts ./
COPY src/ ./src/
COPY docker-entrypoint.sh ./

# Pre-cache all JSR/remote dependencies using the committed lockfile.
# The container starts without network access to registries.
RUN deno cache --lock=deno.lock server.ts mod.ts

EXPOSE 3018

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["http"]
