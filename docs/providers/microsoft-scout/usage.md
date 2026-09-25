# Microsoft Scout usage

Start a new Scout conversation and say:

```text
Track this conversation with Context Workspace.
```

Scout creates an unassigned Context Workspace session and keeps its session ID in the conversation context.

Scout also accepts Context Workspace commands as chat text:

```text
/cw:wrap
/cw:wrap-session
/cw:handoff
/cw:project
```

`/cw:wrap-session` is a Scout compatibility alias for `/cw:wrap`. Scout verifies that the session appears in the dashboard before reporting successful tracking or wrapping.

## Save continuity

Tell Scout:

```text
Wrap this session.
```

or:

```text
Checkpoint this session and save the next actions.
```

For a checkpoint that also marks the session paused, say:

```text
Hand this session off and pause it.
```

## Projects

Ask Scout explicitly before creating, linking, switching, sharing, archiving, or completing a project. Context Workspace never assigns a Scout session to a project based only on its folder or repository.

## Resume

Restore the conversation from Scout's own conversation history. Scout does not currently expose a supported external command for launching a specific conversation, so the dashboard does not show **Resume this session** for Scout sessions.
