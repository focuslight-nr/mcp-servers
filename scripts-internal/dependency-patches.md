# Development dependency patches

There is no published fixed release for braces GHSA-vfj7-8cjw-p6xm or
node-forge GHSA-86w9-cpqp-85rv as of 2026-10-10. Their original package names and
versions remain in the lockfile; npm audit still reports these advisories.
Do not interpret a patched installation as an upstream fixed release.

`npm install` and `npm ci` apply `dependency-patches.json` through the root
postinstall script. When lifecycle scripts are disabled, explicitly run
`npm run deps:patch`. CI does this through `npm run test:dependency-patches`.
The patcher checks the installed version and SHA-256 of each original or patched
file. Unknown source or versions stop installation for review. It applies to
every locked installation, is idempotent, and skips omitted development packages
in production-only installs.

- braces 3.0.3: cap parsed brace/parenthesis nesting and each recursive AST walker
  at 128 levels. This covers strings and caller-supplied ASTs, including direct
  library imports. Deeper patterns now throw a deliberate SyntaxError rather than
  exhausting the call stack. Ordinary expansion, compilation, escaping and range
  limits retain their behavior. The limit cannot be disabled through options.
- node-forge 1.4.0: require the nested DigestAlgorithm sequence to contain an OID
  and at most one empty NULL parameter. Reject extra elements, non-NULL second
  elements and nonempty NULL parameters. Omitted NULL remains supported for the
  algorithms already allowed by Forge; its existing MD2/MD5 requirements remain.
  This follows the element-count approach proposed in
  [Forge PR 1152](https://github.com/digitalbazaar/forge/pull/1152), which is not
  yet merged, with explicit parameter validation.
- sprintf-js GHSA-hp3w-g68c-fv3c: remove the dependency by updating read-yaml-file
  to its CommonJS-compatible 2.1.0 and the Istanbul config loader to js-yaml 4.
  Async/sync workspace YAML and coverage YAML are covered by regression tests.

When an upstream fixed release becomes available, remove its patch only after
updating the lockfile and running `npm run test:dependency-patches`. Keep the
regression tests. Do not suppress npm audit findings or invent fixed versions.
