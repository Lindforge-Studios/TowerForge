import { describe, expect, it } from "vitest";
import { layoutTowerScriptGraph } from "./towerscript-layout.mjs";

const graph = {
  schemaVersion: 2,
  scriptId: "layout_contract",
  nodes: [
    { id: "script", kind: "script", astPath: "", raw: {} },
    { id: "tree", kind: "behavior_tree", astPath: "/behaviorTrees/0", raw: {} },
    { id: "selector", kind: "behavior_selector", astPath: "/behaviorTrees/0/root", raw: {} },
    { id: "condition", kind: "behavior_condition", astPath: "/behaviorTrees/0/root/children/0", raw: {} },
    { id: "action", kind: "behavior_action", astPath: "/behaviorTrees/0/root/children/1", raw: {} },
    { id: "machine", kind: "state_machine", astPath: "/stateMachines/0", raw: {} },
    { id: "state", kind: "state", astPath: "/stateMachines/0/states/0", raw: {} },
    { id: "nested", kind: "state", astPath: "/stateMachines/0/states/0/states/0", raw: {} },
    { id: "transition", kind: "transition", astPath: "/stateMachines/0/states/0/transitions/0", raw: {} }
  ],
  edges: [
    ["script", "tree", 0], ["tree", "selector", 0], ["selector", "condition", 0], ["selector", "action", 1],
    ["script", "machine", 1], ["machine", "state", 0], ["state", "transition", 0], ["state", "nested", 1]
  ].map(([from, to, order], index) => ({ id: `e${index}`, kind: "containment", from, to, order }))
};

function overlaps(left, right) {
  return left.x < right.x + 260 && left.x + 260 > right.x
    && left.y < right.y + 286 && left.y + 286 > right.y;
}

describe("TowerScript Graph v2 automatic layout", () => {
  it("lays BT and nested HFSM containment out deterministically without overlaps", () => {
    const forward = layoutTowerScriptGraph(graph);
    const reversed = layoutTowerScriptGraph({
      ...graph,
      nodes: [...graph.nodes].reverse(),
      edges: [...graph.edges].reverse()
    });

    expect(reversed).toEqual(forward);
    expect(forward.tree.x).toBe(forward.machine.x);
    expect(forward.selector.x).toBe(forward.state.x);
    expect(forward.condition.x).toBeGreaterThan(forward.selector.x);
    expect(forward.nested.x).toBeGreaterThan(forward.state.x);

    const positions = Object.values(forward);
    for (let left = 0; left < positions.length; left += 1) {
      for (let right = left + 1; right < positions.length; right += 1) {
        expect(overlaps(positions[left], positions[right])).toBe(false);
      }
    }
  });

  it("preserves finite manual layout v1 positions and routes new nodes around them", () => {
    const existing = {
      script: { x: 640, y: 80, collapsed: true },
      tree: { x: 24, y: 24 }
    };
    const layout = layoutTowerScriptGraph(graph, existing);

    expect(layout.script).toEqual(existing.script);
    expect(layout.tree).toEqual(existing.tree);
    expect(overlaps(layout.tree, layout.machine)).toBe(false);
    expect(existing).toEqual({ script: { x: 640, y: 80, collapsed: true }, tree: { x: 24, y: 24 } });
    expect(layoutTowerScriptGraph(graph, layout)).toEqual(layout);
    const movedPaths = {
      ...graph,
      nodes: graph.nodes.map((node) => node.id === "tree" ? { ...node, astPath: "/behaviorTrees/4" } : node)
    };
    expect(layoutTowerScriptGraph(movedPaths, layout).tree).toEqual(existing.tree);
  });
});
