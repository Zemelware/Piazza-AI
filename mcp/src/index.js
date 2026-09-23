#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { log } from "./config.js";
import { PiazzaClient } from "./piazza.js";
import { registerTools } from "./tools.js";

const server = new McpServer(
  { name: "piazza", version: "0.1.0" },
  {
    instructions:
      "Tools for reading the user's Piazza class forums. Typical flow: pick the class (list_classes, " +
      "or omit class_id if the user has one active class), find posts with search_posts, get_folder_posts " +
      "or get_feed, then read them with get_post. Cite post URLs when answering from Piazza. " +
      "Login happens automatically in a browser window the first time a tool is used.",
  }
);

registerTools(server, new PiazzaClient());

await server.connect(new StdioServerTransport());
log("Server running");
