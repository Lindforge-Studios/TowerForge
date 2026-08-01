# R17 opt-in web distribution

This fixture demonstrates the constructor-only Distribution v1 boundary. Save `distribution.json`
as `content/distribution.json` through the guarded Distribution Hub or MCP preview/apply workflow;
the same explicit transaction promotes `project.json` to schema v4 as shown in
`project-version.json`. Do not copy the version snippet as a replacement manifest.

The example permits a public deterministic Remix source pack with attribution and exposes one inert
host purchase-link placement. It contains no URL, provider credential, payment key, telemetry or
gameplay reward. Removing `content/distribution.json` returns the project to the distribution-free
Studio/player/package path; mission mechanics, simulation, checkpoints and replay digests do not
change.

Use the AI flow:

`describe_schema(distribution) -> read_distribution_config -> preview_distribution_config -> apply_distribution_config(ifRevision) -> validate_project -> preview_publish_candidate`.

External upload remains a Studio/user action with exact confirmation. MCP cannot mint an approval,
create a provider runtime or upload this project.
