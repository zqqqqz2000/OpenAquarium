import { describe, expect, it } from "vitest";

import {
  buildAqTodoFlowGraph,
  estimateAqTodoNodeSize,
  parseAqTodoXml,
} from "@/lib/aqtodo";

const SAMPLE_TODO_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<aqtodo version="1" roomId="room-a" roomName="Alpha" title="Alpha plan">',
  '  <node id="root" title="Alpha plan" status="in_progress" member="@lead" progress="40" tags="planning roadmap">',
  "    <note>Track delivery work.</note>",
  "    <details>Keep evidence user-facing.</details>",
  '    <code language="ts">console.log("hello");\nconsole.log("world");</code>',
  '    <image src="./artifacts/proof.png" alt="proof" />',
  '    <node id="child" title="Implement preview" status="todo" member="@builder" priority="p1" />',
  "  </node>",
  "</aqtodo>",
].join("\n");

describe("aqtodo helpers", () => {
  it("parses xml nodes, metadata, and embedded evidence", () => {
    const document = parseAqTodoXml(SAMPLE_TODO_XML);

    expect(document.roomId).toBe("room-a");
    expect(document.title).toBe("Alpha plan");
    expect(document.root.title).toBe("Alpha plan");
    expect(document.root.progress).toBe(40);
    expect(document.root.tags).toEqual(["planning", "roadmap"]);
    expect(document.root.codes[0]).toEqual({
      language: "ts",
      content: 'console.log("hello");\nconsole.log("world");',
    });
    expect(document.root.images[0]).toEqual({
      alt: "proof",
      src: "./artifacts/proof.png",
    });
    expect(document.root.children[0]?.member).toBe("@builder");
  });

  it("keeps estimated node sizes within the supported bounds", () => {
    const document = parseAqTodoXml(SAMPLE_TODO_XML);
    const size = estimateAqTodoNodeSize(document.root);

    expect(size.width).toBeGreaterThanOrEqual(220);
    expect(size.width).toBeLessThanOrEqual(360);
    expect(size.height).toBeGreaterThanOrEqual(92);
    expect(size.height).toBeLessThanOrEqual(320);
  });

  it("builds a left-to-right flow graph for react flow", () => {
    const document = parseAqTodoXml(SAMPLE_TODO_XML);
    const graph = buildAqTodoFlowGraph({
      document,
      roomId: "room-a",
    });
    const rootNode = graph.nodes.find((node) => node.id === "root");
    const childNode = graph.nodes.find((node) => node.id === "child");

    expect(graph.nodes.length).toBe(2);
    expect(graph.edges).toEqual([
      expect.objectContaining({
        id: "root->child",
        source: "root",
        target: "child",
        type: "smoothstep",
      }),
    ]);
    expect(rootNode?.sourcePosition).toBeDefined();
    expect(childNode?.targetPosition).toBeDefined();
    expect(childNode?.position.x).toBeGreaterThan(rootNode?.position.x ?? 0);
  });
});
