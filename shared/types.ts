// Shared types for the Pulumi Graph data model

export type GraphTextArg = {
  type: "text";
  content: string;
};

export type GraphLinkArg = {
  type: "link";
  // property path on the dependent node that links to the source node
  prop: string;
  // index of the source node this arg links to
  source: number;
};

export type GraphArgValue = GraphTextArg | GraphLinkArg;

export type GraphNode = {
  pulumiClass: string;
  label: string;
  // Flat key-value pairs for args, Mongo-style dotted paths
  argsFlat: ReadonlyArray<readonly [string, GraphArgValue]>;
};

export type GraphData = ReadonlyArray<GraphNode>;
