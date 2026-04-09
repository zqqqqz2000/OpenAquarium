import { describe, expect, it } from "vitest";

import {
  buildAqTodoNodeAggregates,
  deriveAqTodoDisplayStatus,
  inferAqTodoNodeProgress,
  parseAqTodoXml,
} from "@/lib/aqtodo";

const SAMPLE_TODO_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<aqtree version="1" roomId="room-a" roomName="Alpha" title="Alpha plan">',
  '  <node id="root" title="Alpha plan" status="in_progress" member="@lead" progress="40" tags="planning roadmap">',
  "    <note>Track delivery work.</note>",
  "    <details>Keep evidence user-facing.</details>",
  '    <code language="ts">console.log("hello");\nconsole.log("world");</code>',
  '    <image src="./artifacts/proof.png" alt="proof" />',
  '    <node id="child" title="Implement preview" status="todo" member="@builder" priority="p1" />',
  "  </node>",
  "</aqtree>",
].join("\n");

const AGGREGATE_TODO_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<aqtree version="1" roomId="room-a" roomName="Alpha" title="Alpha grouped plan">',
  '  <node id="root" title="Alpha grouped plan" status="in_progress" progress="10">',
  '    <node id="product" title="Product track" status="in_progress" progress="90">',
  '      <node id="ux" title="UI polish" status="done" />',
  '      <node id="copy" title="Copy review" status="todo" />',
  "    </node>",
  '    <node id="ops" title="Ops track" status="blocked">',
  '      <node id="qa" title="QA sweep" status="in_progress" progress="25" />',
  '      <node id="handoff" title="Room handoff" status="blocked" />',
  "    </node>",
  "  </node>",
  "</aqtree>",
].join("\n");

const COMPLETED_TODO_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<aqtree version="1" roomId="room-a" roomName="Alpha" title="Alpha shipped plan">',
  '  <node id="root" title="Alpha shipped plan" status="in_progress">',
  '    <node id="launch" title="Launch checklist" status="in_progress" progress="100">',
  '      <node id="ship-ui" title="Ship UI" status="done" />',
  '      <node id="ship-runtime" title="Ship runtime" status="done" />',
  "    </node>",
  "  </node>",
  "</aqtree>",
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

  it("infers single-node progress from explicit progress or built-in status fallbacks", () => {
    const document = parseAqTodoXml(AGGREGATE_TODO_XML);
    const [productNode, opsNode] = document.root.children;
    const [uxNode, copyNode] = productNode?.children ?? [];
    const [qaNode, handoffNode] = opsNode?.children ?? [];

    expect(inferAqTodoNodeProgress(document.root)).toBe(10);
    expect(inferAqTodoNodeProgress(productNode)).toBe(90);
    expect(inferAqTodoNodeProgress(uxNode)).toBe(100);
    expect(inferAqTodoNodeProgress(copyNode)).toBe(0);
    expect(inferAqTodoNodeProgress(qaNode)).toBe(25);
    expect(inferAqTodoNodeProgress(handoffNode)).toBe(0);
  });

  it("aggregates category progress from descendant leaf nodes", () => {
    const document = parseAqTodoXml(AGGREGATE_TODO_XML);
    const aggregates = buildAqTodoNodeAggregates(document.root);

    expect(aggregates.get("root")).toEqual(
      expect.objectContaining({
        completion: 31.25,
        depth: 0,
        directChildCount: 2,
        doneItemCount: 1,
        isCategory: true,
        levelCount: 3,
        totalItemCount: 4,
      }),
    );
    expect(aggregates.get("root")?.statusCounts).toEqual({
      blocked: 1,
      done: 1,
      in_progress: 1,
      todo: 1,
    });
    expect(aggregates.get("product")).toEqual(
      expect.objectContaining({
        completion: 50,
        depth: 1,
        doneItemCount: 1,
        isCategory: true,
        levelCount: 2,
        totalItemCount: 2,
      }),
    );
    expect(aggregates.get("ops")).toEqual(
      expect.objectContaining({
        completion: 12.5,
        depth: 1,
        doneItemCount: 0,
        isCategory: true,
        levelCount: 2,
        totalItemCount: 2,
      }),
    );
  });

  it("derives category display status from descendant completion instead of stale parent status", () => {
    const document = parseAqTodoXml(AGGREGATE_TODO_XML);
    const completedDocument = parseAqTodoXml(COMPLETED_TODO_XML);
    const aggregates = buildAqTodoNodeAggregates(document.root);
    const completedAggregates = buildAqTodoNodeAggregates(completedDocument.root);
    const [productNode, opsNode] = document.root.children;
    const [launchNode] = completedDocument.root.children;

    expect(deriveAqTodoDisplayStatus(document.root, aggregates.get("root"))).toBe(
      "in_progress",
    );
    expect(deriveAqTodoDisplayStatus(productNode, aggregates.get("product"))).toBe(
      "in_progress",
    );
    expect(deriveAqTodoDisplayStatus(opsNode, aggregates.get("ops"))).toBe(
      "in_progress",
    );
    expect(
      deriveAqTodoDisplayStatus(
        completedDocument.root,
        completedAggregates.get("root"),
      ),
    ).toBe("done");
    expect(
      deriveAqTodoDisplayStatus(launchNode, completedAggregates.get("launch")),
    ).toBe("done");
  });
});
