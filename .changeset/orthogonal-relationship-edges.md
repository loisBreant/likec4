---
'@likec4/diagram': patch
'@likec4/vite-plugin': patch
'@likec4/config': patch
'likec4': patch
---

Add an option to render relationship edges as orthogonal paths — horizontal and vertical segments with 90-degree corners — instead of curves.

Enable it per project in `likec4.config.json`:

```json
{
  "name": "my-project",
  "webapp": {
    "orthogonalEdges": true
  }
}
```

The webapp, previews and exports all follow this setting, as do the relationship details and relationships browser overlays. Arrows attach to the middle of a node border, and parallel relationships between the same two nodes are drawn side by side rather than on top of each other. Omitted or `false` keeps the existing curved edges, so nothing changes unless you opt in.

`@likec4/diagram` consumers can also set it directly with the `enableOrthogonalEdges` prop on `LikeC4Diagram`.
