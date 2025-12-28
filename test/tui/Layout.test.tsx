/**
 * Layout Component Tests
 */

import React from "react";

// Mock ink components
jest.mock("ink", () => ({
  Box: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

import { Layout } from "../../src/tui/components/Layout";

// Simple render to string
function renderToString(element: React.ReactElement): { container: string } {
  const ReactDOMServer = require("react-dom/server");
  const html = ReactDOMServer.renderToStaticMarkup(element);
  // Strip HTML tags to get text content
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return { container: text };
}

// Helper to extract text content from React element
function getTextContent(element: React.ReactElement): string {
  const { container } = renderToString(element);
  return container;
}

describe("Layout", () => {
  describe("header", () => {
    it("displays the title", () => {
      const output = getTextContent(
        <Layout title="Workspaces" breadcrumb={["Apso"]}>
          <span>Content</span>
        </Layout>
      );

      expect(output).toContain("Workspaces");
    });

    it("displays breadcrumb with single item", () => {
      const output = getTextContent(
        <Layout title="Home" breadcrumb={["Apso"]}>
          <span>Content</span>
        </Layout>
      );

      expect(output).toContain("Apso");
    });

    it("displays breadcrumb with multiple items", () => {
      const output = getTextContent(
        <Layout title="Schema" breadcrumb={["Apso", "acme-corp", "api-v1"]}>
          <span>Content</span>
        </Layout>
      );

      expect(output).toContain("Apso");
      expect(output).toContain("acme-corp");
      expect(output).toContain("api-v1");
    });
  });

  describe("content", () => {
    it("renders children in content area", () => {
      const output = getTextContent(
        <Layout title="Test" breadcrumb={["Apso"]}>
          <span>This is the content area</span>
        </Layout>
      );

      expect(output).toContain("This is the content area");
    });

    it("renders multiple children", () => {
      const output = getTextContent(
        <Layout title="Test" breadcrumb={["Apso"]}>
          <span>Line 1</span>
          <span>Line 2</span>
        </Layout>
      );

      expect(output).toContain("Line 1");
      expect(output).toContain("Line 2");
    });
  });
});
